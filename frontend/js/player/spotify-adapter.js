/**
 * Skysync - Spotify Web Playback SDK Adapter (Fase 16: Eliminação de Condições de Corrida)
 * 
 * Proteções implementadas:
 * 1. Inicialização Condicionada (AudioContext Unlock): O SDK não chama player.connect()
 *    no carregamento da página. A conexão ocorre após o clique do usuário na Splash Screen.
 * 2. Serialização por Request Token: cada loadTrack() incrementa this.loadRequestId; após cada
 *    await, execuções obsoletas abortam (sem PUT, sem rampa de volume, sem callbacks).
 * 3. Trava de Transição por URI: this.isTransitioning só é liberada quando o SDK reporta a URI
 *    esperada (this.expectedUri) tocando. Estados vindos da URI antiga são descartados.
 * 4. True End Detection por URI: onTrackEndCallback só dispara para a URI esperada, fora de
 *    transição, com paused === true, position === 0 e lastPosition > 0 (polling failsafe removido).
 * 5. Volume 100% local via player.setVolume() do SDK (nenhum HTTP /me/player/volume).
 *    Transição em stream único: fade-out local (800ms) → PUT /me/player/play → fade-in local.
 * 6. Transfer Playback Seguro: No evento ready, executa PUT /me/player com play: false.
 */

class SpotifyAdapter {
  constructor() {
    this.name = 'spotify';
    this.STORAGE_KEYS = {
      TOKEN: 'skysync_spotify_token',
      LEGACY_TOKEN: 'spotify_access_token',
      EXPIRATION_TIME: 'skysync_spotify_expiration_time',
      VOLUME: 'skysync_volume',
    };

    this.player = null;
    this.deviceId = null;
    this.isReady = false;
    this.isPlayingTrack = false;
    this.wasPlaying = false;
    this.currentTrack = null;

    // Requisito 2: Rastreamento da posição anterior para True End Detection
    this.lastPosition = 0;

    // Flag de controle de pause manual pelo usuário
    this.manuallyPausedByUser = false;

    // Requisito 3: Trava de transição e debounce contra loops de buffering
    this.isTransitioning = false;
    this.transitionTimeout = null;

    // Fase 16 (Achados A/E): Request Token de serialização e URI esperada nos estados do SDK
    this.loadRequestId = 0;
    this.expectedUri = null;

    // Volume padrão (0.0 a 1.0)
    this.volume = parseFloat(localStorage.getItem(this.STORAGE_KEYS.VOLUME)) || 0.85;
    this.currentVolumePercent = Math.round(this.volume * 100);
    this.crossfadeInterval = null;
    this._rampResolve = null;

    // Fase 16 (Achado F): parâmetros das rampas locais de volume
    this.FADE = {
      OUT_MS: 800,
      OUT_STEP_MS: 50,
      IN_STEP_MS: 100,
      TRANSITION_TIMEOUT_MS: 5000,
    };

    // Fim de faixa já sinalizado para a faixa atual (evita disparos duplicados)
    this.hasTriggeredTrackEnd = false;

    // Promessas de conexão e inicialização
    this.connectPromise = null;
    this.readyResolve = null;

    // Callbacks do PlayerManager
    this.onStateChangeCallback = null;
    this.onTrackEndCallback = null;
    this.onErrorCallback = null;
  }

  /**
   * Requisito 2 (Fase 18: Validação Rigorosa de Token / Anti-Zombie Token):
   * Verifica se o token expirou (Date.now() > expiration_time).
   * Se expirado ou inválido, apaga do localStorage e retorna null,
   * forçando o frontend a mostrar o botão de 'Conectar Spotify' novamente.
   */
  getToken() {
    const token =
      localStorage.getItem(this.STORAGE_KEYS.TOKEN) ||
      localStorage.getItem(this.STORAGE_KEYS.LEGACY_TOKEN) ||
      null;

    if (!token) {
      return null;
    }

    const expirationStr = localStorage.getItem(this.STORAGE_KEYS.EXPIRATION_TIME);
    if (expirationStr) {
      const expirationTime = parseInt(expirationStr, 10);
      if (isNaN(expirationTime) || Date.now() > expirationTime) {
        console.warn('🔒 [Skysync Spotify] Token expirado detectado no LocalStorage (Anti-Zombie Token). Limpando...');
        this.clearToken();
        window.dispatchEvent(new CustomEvent('skysync:token-expired'));
        return null;
      }
    } else {
      // Token sem timestamp de expiração salvo em versões anteriores: trata como expirado
      console.warn('🔒 [Skysync Spotify] Token legado sem timestamp de expiração. Limpando...');
      this.clearToken();
      window.dispatchEvent(new CustomEvent('skysync:token-expired'));
      return null;
    }

    return token;
  }

  /**
   * Remove tokens e timestamps de autenticação do localStorage.
   */
  clearToken() {
    localStorage.removeItem(this.STORAGE_KEYS.TOKEN);
    localStorage.removeItem(this.STORAGE_KEYS.LEGACY_TOKEN);
    localStorage.removeItem(this.STORAGE_KEYS.EXPIRATION_TIME);
  }

  /**
   * Requisito 1: Desbloqueio de Áudio Nativo (AudioContext Unlock).
   * Método síncrono para ser chamado diretamente no gesto de clique do usuário
   * antes de qualquer await, garantindo conformidade com as políticas de autoplay do navegador.
   */
  unlockAudio() {
    if (!this.player && window.Spotify) {
      this._setupPlayerInstance();
    }
    if (this.player && typeof this.player.activateElement === 'function') {
      this.player.activateElement();
    }
  }

  /**
   * Requisito 1: Inicialização Condicionada (AudioContext Unlock).
   * Carrega o script 'spotify-player.js' e instancia o Player sem chamar player.connect().
   * A chamada a player.connect() é executada EXCLUSIVAMENTE após a interação do usuário
   * (ao clicar no botão 'Iniciar/Continuar Leitura' na Splash Screen).
   */
  async init() {
    const token = this.getToken();
    if (!token) {
      console.warn(
        '⚠️ [Skysync Spotify] Token não encontrado no localStorage. O player será ativado após o login.'
      );
      return null;
    }

    console.log('🎧 [Skysync Spotify] Preparando Spotify Web Playback SDK (sem connect automático)...');
    await this._loadSDKScript();

    if (window.Spotify) {
      this._setupPlayerInstance();
    }

    return true;
  }

  /**
   * Conecta oficialmente o Spotify Player ao ecossistema Spotify.
   * Deve ser disparado após a interação do usuário na Splash Screen para destravar o AudioContext.
   * @returns {Promise<string|null>} Retorna o device_id quando o player estiver pronto.
   */
  connect() {
    if (this.isReady && this.deviceId) {
      return Promise.resolve(this.deviceId);
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise(async (resolve) => {
      const token = this.getToken();
      if (!token) {
        console.warn('⚠️ [Skysync Spotify] Não é possível conectar: token ausente.');
        this.connectPromise = null;
        resolve(null);
        return;
      }

      console.log('🔗 [Skysync Spotify] Inicializando conexão do Player após interação do usuário (AudioContext Unlock)...');

      // Guarda o resolver para quando o evento 'ready' registrar o device_id
      this.readyResolve = resolve;

      // Timeout de segurança caso o Spotify demore a responder
      const safetyTimeout = setTimeout(() => {
        if (!this.isReady) {
          console.warn('⚠️ [Skysync Spotify] Timeout de 12s aguardando evento ready do dispositivo.');
          if (this.readyResolve) {
            this.readyResolve(this.deviceId || null);
            this.readyResolve = null;
          }
        }
      }, 12000);

      const onReadyResolved = (devId) => {
        clearTimeout(safetyTimeout);
        resolve(devId);
      };
      this.readyResolve = onReadyResolved;

      // Desbloqueio imediato síncrono antes de qualquer await se window.Spotify já existir
      if (!this.player && window.Spotify) {
        this._setupPlayerInstance();
      }
      if (this.player && typeof this.player.activateElement === 'function') {
        this.player.activateElement();
      }

      // Garante que o SDK e a instância existam
      if (!this.player) {
        await this._loadSDKScript();
        this._setupPlayerInstance();
        if (this.player && typeof this.player.activateElement === 'function') {
          this.player.activateElement();
        }
      }

      if (this.player) {
        try {
          const success = await this.player.connect();
          if (success) {
            console.log('🔗 [Skysync Spotify SDK] Conexão com o servidor do Spotify estabelecida com sucesso.');
          } else {
            console.warn('⚠️ [Skysync Spotify SDK] Falha ao conectar ao servidor do Spotify.');
            clearTimeout(safetyTimeout);
            this.connectPromise = null;
            resolve(null);
          }
        } catch (err) {
          console.error('❌ [Skysync Spotify SDK] Exceção durante player.connect():', err);
          clearTimeout(safetyTimeout);
          this.connectPromise = null;
          resolve(null);
        }
      } else {
        clearTimeout(safetyTimeout);
        this.connectPromise = null;
        resolve(null);
      }
    });

    return this.connectPromise;
  }

  /**
   * Carrega o script oficial do SDK caso não exista na página.
   */
  _loadSDKScript() {
    return new Promise((resolve) => {
      if (window.Spotify) {
        resolve();
        return;
      }

      const prevCallback = window.onSpotifyWebPlaybackSDKReady;
      window.onSpotifyWebPlaybackSDKReady = () => {
        if (typeof prevCallback === 'function') prevCallback();
        resolve();
      };

      if (!document.getElementById('spotify-player-sdk-script')) {
        const script = document.createElement('script');
        script.id = 'spotify-player-sdk-script';
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.head.appendChild(script);
      }
    });
  }

  /**
   * Instancia o objeto Spotify.Player e configura todos os ouvintes de eventos.
   * Não chama player.connect() aqui.
   */
  _setupPlayerInstance() {
    if (this.player || !window.Spotify) return;

    this.player = new window.Spotify.Player({
      name: 'Skysync Player',
      getOAuthToken: (cb) => {
        const currentToken = this.getToken();
        cb(currentToken);
      },
      volume: this.volume,
    });

    // Desbloqueio nativo do elemento de áudio no momento da criação
    if (typeof this.player.activateElement === 'function') {
      this.player.activateElement();
    }

    // Evento ready: Dispositivo registrado e pronto para receber comandos
    this.player.addListener('ready', async ({ device_id }) => {
      console.log(`🎧 [Skysync Spotify SDK] Dispositivo registrado com sucesso: 'Skysync Player' (ID: ${device_id})`);
      this.deviceId = device_id;
      this.isReady = true;

      // Requisito 4: Transfer Playback Seguro com play: false
      await this.transferPlayback(device_id);

      if (typeof this.readyResolve === 'function') {
        this.readyResolve(device_id);
        this.readyResolve = null;
      }
    });

    // Evento not_ready: Dispositivo offline
    this.player.addListener('not_ready', ({ device_id }) => {
      console.warn(`⚠️ [Skysync Spotify SDK] Dispositivo offline: ${device_id}`);
      this.isReady = false;
    });

    // Evento player_state_changed: Atualização de status e faixas
    this.player.addListener('player_state_changed', (state) => {
      this._handlePlayerStateChanged(state);
    });

    // Tratamento de erros oficiais do SDK (Fase 18: Limpeza de Erros e Pulos)
    this.player.addListener('initialization_error', ({ message }) => {
      console.error('❌ [Skysync Spotify] Erro de inicialização do SDK:', message);
      if (this.onErrorCallback) this.onErrorCallback('initialization_error', this.currentTrack);
    });

    this.player.addListener('authentication_error', ({ message }) => {
      console.error('🔒 [Skysync Spotify] Erro de autenticação (Token inválido/expirado):', message);
      this._handleCriticalAuthError('auth_error', message);
    });

    this.player.addListener('account_error', ({ message }) => {
      console.error('🚫 [Skysync Spotify] Conta não compatível (Requer Spotify Premium):', message);
      this._handleCriticalAuthError('premium_required', message);
    });

    this.player.addListener('playback_error', ({ message }) => {
      console.warn('⚠️ [Skysync Spotify] Erro na reprodução da faixa:', message);
      if (this.onErrorCallback && !this.isTransitioning) {
        this.onErrorCallback(message, this.currentTrack);
      }
    });
  }

  /**
   * Requisito 4: Transfer Playback Seguro
   * No evento ready, faz PUT https://api.spotify.com/v1/me/player passando {"device_ids": [device_id], "play": false}.
   * Não força o play aqui; deixa o PlayerManager dar o comando oficial de play.
   */
  async transferPlayback(deviceId) {
    const token = this.getToken();
    if (!token || !deviceId) return;

    try {
      console.log(`🔀 [Skysync Spotify] Transferindo playback para 'Skysync Player' (${deviceId}) [play: false]...`);
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: false,
        }),
      });

      if (response.ok || response.status === 204 || response.status === 202) {
        console.log('✅ [Skysync Spotify] Playback transferido com sucesso para Skysync Player (play: false mantido).');
      } else if (response.status === 401 || response.status === 403) {
        console.warn(`🔒 [Skysync Spotify] Falha de autorização ao transferir playback (HTTP ${response.status}).`);
        this._handleCriticalAuthError(
          response.status === 401 ? 'auth_error' : 'premium_required',
          `HTTP ${response.status} ao transferir playback`
        );
      } else {
        console.warn(`[Skysync Spotify] Resposta ao transferir playback: HTTP ${response.status}`);
      }
    } catch (e) {
      console.warn('[Skysync Spotify] Falha ao transferir playback para device_id:', e);
    }
  }

  /**
   * Carrega e reproduz uma faixa no Spotify (Fase 16).
   * Transição real em stream único: Fade-Out local (800ms) → PUT /me/player/play → Fade-In local.
   * Serializada por Request Token (Achado A): uma nova chamada invalida as anteriores; após cada
   * await, execuções obsoletas abortam sem enviar comandos ao Spotify nem disparar callbacks.
   * @param {Object} trackData - Objeto da faixa com providers.spotify (uri ou id)
   * @param {boolean} autoplay - Se false, a faixa é carregada e pausada imediatamente
   * @param {number} fadeDurationMs - Duração do fade-in local (o fade-out é fixo em FADE.OUT_MS)
   */
  async loadTrack(trackData, autoplay = true, fadeDurationMs = 4000) {
    // Achado A: Request Token — invalida execuções anteriores e interrompe qualquer rampa ativa
    const reqId = ++this.loadRequestId;
    this._cancelRamp();

    const spData = trackData?.providers?.spotify;
    let trackUri = spData?.uri;

    if (!trackUri && spData?.id) {
      trackUri = `spotify:track:${spData.id}`;
    }

    if (!trackUri) {
      console.warn('⚠️ [Skysync Spotify] Faixa sem URI ou ID válido do Spotify:', trackData);
      if (this.onErrorCallback) this.onErrorCallback('invalid_track', trackData);
      return;
    }

    const token = this.getToken();
    if (!token) {
      console.warn('[Skysync Spotify] Reprodução abortada: usuário não autenticado ou token expirado.');
      this._releaseTransitionLock();
      this._handleCriticalAuthError('auth_missing', 'Token ausente ou expirado ao carregar faixa.');
      return;
    }

    // Se o player ainda não estiver conectado e pronto, conecta com o contexto atual
    if (!this.isReady || !this.deviceId) {
      console.log('🔄 [Skysync Spotify] Dispositivo não está pronto ainda. Conectando antes de carregar faixa...');
      await this.connect();
      if (reqId !== this.loadRequestId) return;
    }

    // Fade-out somente se houver áudio audível da faixa anterior
    const shouldFadeOut = this.isPlayingTrack && fadeDurationMs > 0;

    this.currentTrack = trackData;
    this.expectedUri = trackUri;
    this.manuallyPausedByUser = !autoplay;
    this.hasTriggeredTrackEnd = false;
    this.lastPosition = 0;

    // Achado E: Trava de Transição — estados são ignorados até o SDK confirmar expectedUri tocando
    this._armTransitionLock(reqId);

    console.log(
      `🎵 [Skysync Spotify] Carregando faixa #${reqId}: '${trackData.title}' (${trackUri}) ` +
      `[Autoplay: ${autoplay}, Fade-out: ${shouldFadeOut ? this.FADE.OUT_MS : 0}ms, ` +
      `Fade-in: ${fadeDurationMs}ms, Device: ${this.deviceId}]`
    );

    try {
      // 1. Fade-out local rápido da faixa anterior (ou zera o volume antes do play)
      if (shouldFadeOut) {
        await this._rampVolume(this.currentVolumePercent, 0, this.FADE.OUT_MS, this.FADE.OUT_STEP_MS, reqId);
      } else if (fadeDurationMs > 0 || !autoplay) {
        await this._setVolumeNative(0);
      }
      if (reqId !== this.loadRequestId) return;

      // 2. Requisição PUT /me/player/play com a nova URI
      const playUrl = this.deviceId
        ? `https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`
        : 'https://api.spotify.com/v1/me/player/play';

      const response = await fetch(playUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uris: [trackUri],
        }),
      });
      if (reqId !== this.loadRequestId) return;

      if (!response.ok && response.status !== 204 && response.status !== 202) {
        const errText = await response.text().catch(() => '');
        if (reqId !== this.loadRequestId) return;
        console.warn(`[Skysync Spotify] Erro ao iniciar faixa via API (HTTP ${response.status}):`, errText);
        this._releaseTransitionLock();

        // Requisito 4 (Fase 18: Limpeza de Erros e Pulos):
        // Se o erro for de autenticação/permissão (Token rejeitado 401 ou Conta Free 403),
        // NÃO repassa para o PlayerManager tentar outra música em loop.
        if (response.status === 401 || response.status === 403) {
          const reason = response.status === 401 ? 'auth_error' : 'premium_required';
          this._handleCriticalAuthError(reason, `HTTP ${response.status}: ${errText}`);
          return;
        }

        if (this.onErrorCallback) this.onErrorCallback(`play_failed_${response.status}`, trackData);
        return;
      }

      // Rearma a trava a partir do PUT aceito (o buffering da nova faixa começa agora)
      this._armTransitionLock(reqId);

      // 3. autoplay = false: mantém a faixa carregada, porém pausada
      if (!autoplay) {
        if (this.player) {
          try {
            await this.player.pause();
          } catch (_) {
            // O SDK pode rejeitar o pause durante o buffering inicial
          }
        }
        if (reqId !== this.loadRequestId) return;
        this._releaseTransitionLock();
        this.isPlayingTrack = false;
        if (this.onStateChangeCallback) this.onStateChangeCallback(false);
        await this._setVolumeNative(this._targetVolumePercent());
        return;
      }

      this.isPlayingTrack = true;
      this.wasPlaying = true;
      if (this.onStateChangeCallback) this.onStateChangeCallback(true);

      // 4. Fade-in local 0 → volume alvo em passos de 100ms (o alvo acompanha o slider durante a rampa)
      if (fadeDurationMs > 0) {
        await this._rampVolume(0, () => this._targetVolumePercent(), fadeDurationMs, this.FADE.IN_STEP_MS, reqId);
      } else {
        await this._setVolumeNative(this._targetVolumePercent());
      }
    } catch (e) {
      if (reqId !== this.loadRequestId) return;
      console.error('[Skysync Spotify] Exceção ao reproduzir faixa:', e);
      this._releaseTransitionLock();
      if (this.onErrorCallback) this.onErrorCallback('play_exception', trackData);
    }
  }

  /**
   * Ativa a trava de transição com timeout de segurança vinculado ao Request Token.
   * Um timeout de requisição obsoleta nunca libera a trava de uma requisição mais nova.
   */
  _armTransitionLock(reqId) {
    this.isTransitioning = true;
    if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
    this.transitionTimeout = setTimeout(() => {
      this.transitionTimeout = null;
      if (reqId === this.loadRequestId && this.isTransitioning) {
        console.log('⏱️ [Skysync Spotify] Timeout de segurança da trava de transição (5s). Liberando trava.');
        this.isTransitioning = false;
      }
    }, this.FADE.TRANSITION_TIMEOUT_MS);
  }

  _releaseTransitionLock() {
    this.isTransitioning = false;
    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout);
      this.transitionTimeout = null;
    }
  }

  /**
   * Simplificação de _isExpectedState(state) (Correção 2):
   * O Spotify frequentemente altera a URI da faixa por mercado regional.
   * Considera que a faixa esperada começou se URI bater, linked_from bater ou o nome coincidir.
   */
  _isExpectedState(state) {
    const current = state?.track_window?.current_track;
    if (!current) return false;
    return (
      (Boolean(this.expectedUri) && current.uri === this.expectedUri) ||
      (Boolean(this.expectedUri) && current.linked_from?.uri === this.expectedUri) ||
      (Boolean(current.name) &&
        Boolean(this.currentTrack?.title) &&
        current.name.toLowerCase() === this.currentTrack.title.toLowerCase())
    );
  }

  /**
   * Requisito 2 e 3: Tratamento de mudanças de estado com True End Detection Seguro e
   * Trava de Transição validados pela URI/título esperados.
   */
  _handlePlayerStateChanged(state) {
    if (!state) return;

    const stateUri = state?.track_window?.current_track?.uri || null;
    const isExpectedUri = this._isExpectedState(state);

    // Achado E: Trava de Transição por URI
    if (this.isTransitioning) {
      if (!isExpectedUri || state.paused) {
        if (!isExpectedUri) {
          console.log(`⏳ [Skysync Spotify] Trava de transição ativa: aguardando confirmação da faixa esperada (${stateUri}).`);
        }
        return;
      }
      this._releaseTransitionLock();
    }

    // Fora de transição: estados de outra URI não contaminam playback da faixa atual
    if (!isExpectedUri) {
      return;
    }

    const isPlaying = !state.paused;
    this.isPlayingTrack = isPlaying;

    if (typeof this.onStateChangeCallback === 'function') {
      this.onStateChangeCallback(isPlaying);
    }

    // True End Detection Seguro (Correção 2):
    // Uma música só acaba de verdade se:
    // !this.isTransitioning && state.paused === true && state.position === 0 &&
    // this.lastPosition > 30000 (ou faltavam menos de 10 segundos para state.duration).
    const hasFinishedNormally =
      this.lastPosition > 30000 ||
      (state.duration > 0 && this.lastPosition > 0 && (state.duration - this.lastPosition) < 10000);

    const isNaturalEnd =
      !this.isTransitioning &&
      isExpectedUri &&
      state.paused === true &&
      state.position === 0 &&
      hasFinishedNormally;

    if (state.paused === true && state.position === 0) {
      if (isNaturalEnd) {
        if (!this.hasTriggeredTrackEnd) {
          this.hasTriggeredTrackEnd = true;
          console.log(
            `⏹️ [Skysync Spotify] True End detectado (lastPosition=${this.lastPosition}ms -> position=0ms, paused=true). Disparando transição...`
          );
          this.lastPosition = 0; // reseta a posição após registrar o fim
          if (typeof this.onTrackEndCallback === 'function') {
            this.onTrackEndCallback(this.currentTrack);
          }
        }
      } else if (this.lastPosition <= 30000) {
        // Pause transitório de buffer/relink do Spotify: NUNCA dispare onTrackEndCallback!
        if (!this.manuallyPausedByUser && !this.isTransitioning) {
          console.log(
            `🔄 [Skysync Spotify] Pause transitório de buffer/relink detectado (lastPosition=${this.lastPosition}ms). Retomando playback suavemente...`
          );
          if (this.player && typeof this.player.resume === 'function') {
            this.player.resume().catch(() => {});
          }
        }
      }
    }

    // Enquanto state.paused === false && state.position > 0, atualize this.lastPosition = state.position
    if (!state.paused && state.position > 0) {
      this.lastPosition = state.position;
    }

    this.wasPlaying = isPlaying;
  }

  /**
   * Rampa de volume pública (compatibilidade): transição local suave até o volume alvo.
   */
  crossfade(targetVolFloat, durationMs = 4000) {
    const targetPercent = Math.round(Math.max(0, Math.min(1, targetVolFloat)) * 100);
    return this._rampVolume(
      this.currentVolumePercent,
      targetPercent,
      durationMs,
      this.FADE.IN_STEP_MS,
      this.loadRequestId
    );
  }

  /**
   * Rampa local de volume (Achado F): interpolação linear via player.setVolume() do SDK.
   * - Um único passo em voo por vez (sem sobreposição de chamadas).
   * - Aborta sozinha se o Request Token mudar (nova faixa pedida).
   * - toPercent pode ser função: o alvo é reavaliado a cada passo (respeita o slider durante o fade-in).
   * @returns {Promise<boolean>} true se concluiu, false se foi cancelada/obsoleta.
   */
  _rampVolume(fromPercent, toPercent, durationMs, stepMs, reqId) {
    this._cancelRamp();

    return new Promise((resolve) => {
      const resolveTarget = () => (typeof toPercent === 'function' ? toPercent() : toPercent);
      const startTime = Date.now();
      let inFlight = false;
      let settled = false;
      let intervalId = null;

      const finish = (completed) => {
        if (settled) return;
        settled = true;
        clearInterval(intervalId);
        if (this.crossfadeInterval === intervalId) this.crossfadeInterval = null;
        if (this._rampResolve === cancel) this._rampResolve = null;
        resolve(completed);
      };
      const cancel = () => finish(false);

      const step = async () => {
        if (settled || inFlight) return;
        if (reqId !== this.loadRequestId) {
          finish(false);
          return;
        }
        inFlight = true;
        const progress = durationMs > 0 ? Math.min(1, (Date.now() - startTime) / durationMs) : 1;
        const target = resolveTarget();
        await this._setVolumeNative(fromPercent + (target - fromPercent) * progress);
        inFlight = false;
        if (progress >= 1) finish(true);
      };

      intervalId = setInterval(step, stepMs);
      this.crossfadeInterval = intervalId;
      this._rampResolve = cancel;
      step();
    });
  }

  /**
   * Interrompe imediatamente qualquer rampa de volume ativa e libera quem a aguardava.
   */
  _cancelRamp() {
    if (this.crossfadeInterval) {
      clearInterval(this.crossfadeInterval);
      this.crossfadeInterval = null;
    }
    if (typeof this._rampResolve === 'function') {
      const cancel = this._rampResolve;
      this._rampResolve = null;
      cancel();
    }
  }

  _targetVolumePercent() {
    return Math.round(Math.max(0, Math.min(1, this.volume)) * 100);
  }

  /**
   * Ajuste de volume 100% local via SDK (Achado F).
   * Nenhuma chamada HTTP PUT /me/player/volume: elimina o flood de requisições, o rate limit (429)
   * e a alteração de volume do dispositivo ativo do usuário antes do Skysync Player existir.
   */
  async _setVolumeNative(volumePercent) {
    const clamped = Math.max(0, Math.min(100, Math.round(volumePercent)));
    this.currentVolumePercent = clamped;

    if (!this.player || typeof this.player.setVolume !== 'function') return;

    try {
      await this.player.setVolume(clamped / 100);
    } catch (_) {
      // Silencia falhas transitórias do SDK local
    }
  }

  /**
   * Altera o volume master do player.
   */
  setVolume(volumeFloat) {
    this.volume = Math.max(0, Math.min(1, volumeFloat));
    localStorage.setItem(this.STORAGE_KEYS.VOLUME, this.volume.toString());

    // Se não estiver no meio de um crossfade ativo, ajusta imediatamente
    if (!this.crossfadeInterval) {
      this._setVolumeNative(Math.round(this.volume * 100));
    }
  }

  async play() {
    this.manuallyPausedByUser = false;
    if (!this.isReady && typeof this.connect === 'function') {
      await this.connect();
    }
    if (this.player) {
      // Garante retomada no volume do usuário caso uma rampa tenha sido interrompida em 0
      if (!this.crossfadeInterval) {
        await this._setVolumeNative(this._targetVolumePercent());
      }
      this.player.resume().catch(() => {});
      this.isPlayingTrack = true;
      if (this.onStateChangeCallback) this.onStateChangeCallback(true);
    }
  }

  pause() {
    this.manuallyPausedByUser = true;
    if (this.player) {
      this.player.pause().catch(() => {});
      this.isPlayingTrack = false;
      if (this.onStateChangeCallback) this.onStateChangeCallback(false);
    }
  }

  isPlaying() {
    return this.isPlayingTrack;
  }

  /**
   * Requisito 4 (Fase 18: Limpeza de Erros e Pulos):
   * Se o erro for crítico de autenticação/permissão (Token rejeitado, expirado ou Conta Free):
   * 1. Destrói a instância do player do SDK (player.disconnect() e null).
   * 2. Limpa credenciais do localStorage (clearToken()).
   * 3. Interrompe rampas e travas ativas.
   * 4. NÃO repassa o erro para o PlayerManager sortear outra música em loop.
   * 5. Emite um alerta visual no frontend pedindo para o usuário reconectar a conta.
   */
  _handleCriticalAuthError(reason, details = '') {
    console.error(`🔒 [Skysync Spotify] Tratamento de Erro Crítico (${reason}):`, details);

    // 1. Destrói a instância do player e desvincula ouvintes
    if (this.player) {
      try {
        if (typeof this.player.disconnect === 'function') {
          this.player.disconnect();
        }
      } catch (e) {
        console.warn('[Skysync Spotify] Aviso ao desconectar player:', e);
      }
      this.player = null;
    }

    this.deviceId = null;
    this.isReady = false;
    this.isPlayingTrack = false;
    this.connectPromise = null;
    this.readyResolve = null;

    // 2. Destrava transições e cancela rampa de volume
    this._releaseTransitionLock();
    this._cancelRamp();

    // 3. Remove credenciais do localStorage
    this.clearToken();

    // 4. Notifica o PlayerManager apenas para parar a UI (isPlaying = false), SEM pular faixas
    if (typeof this.onStateChangeCallback === 'function') {
      this.onStateChangeCallback(false);
    }

    // 5. Emite alerta visual no frontend
    this.showAuthErrorAlert(reason, details);

    // 6. Notifica o frontend globalmente
    window.dispatchEvent(
      new CustomEvent('skysync:critical-auth-error', {
        detail: { reason, details },
      })
    );
  }

  /**
   * Emite alerta visual no frontend informando a expiração do token / falta de Spotify Premium.
   */
  showAuthErrorAlert(reason, details = '') {
    const isPremium = reason === 'premium_required';
    const title = isPremium ? 'Spotify Premium Necessário' : 'Sessão do Spotify Expirada';
    const message = isPremium
      ? 'A sua conta do Spotify não possui uma assinatura Premium ativa. O Skysync requer Spotify Premium para streaming adaptativo. Por favor, conecte uma conta com assinatura Premium.'
      : 'Sua sessão do Spotify expirou ou o token foi revogado. Por favor, reconecte sua conta para continuar a ouvir a trilha sonora sincronizada.';

    // Atualiza mensagem na Splash Screen se disponível
    const splashNotice = document.getElementById('splash-auth-notice');
    if (splashNotice) {
      splashNotice.className = 'splash-auth-notice error';
      splashNotice.textContent = message;
      splashNotice.style.display = 'block';
    }

    // Modal de Alerta de Autenticação se presente no DOM
    const modal = document.getElementById('modal-auth-alert');
    const modalTitle = document.getElementById('modal-auth-title');
    const modalDesc = document.getElementById('modal-auth-desc');
    if (modal) {
      if (modalTitle) modalTitle.textContent = title;
      if (modalDesc) modalDesc.textContent = message;
      modal.style.display = 'flex';
    } else {
      this._createFloatingAlert(title, message);
    }
  }

  _createFloatingAlert(title, message) {
    let existing = document.getElementById('skysync-auth-floating-alert');
    if (existing) existing.remove();

    const alertDiv = document.createElement('div');
    alertDiv.id = 'skysync-auth-floating-alert';
    alertDiv.setAttribute('role', 'alert');
    alertDiv.style.cssText = `
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      background: #1a2230;
      border: 1px solid rgba(239, 68, 68, 0.45);
      box-shadow: 0 12px 35px rgba(0, 0, 0, 0.7);
      border-radius: 12px;
      padding: 18px 24px;
      max-width: 520px;
      width: 90%;
      color: #fca5a5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 0.95rem;
      line-height: 1.5;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-sizing: border-box;
    `;
    alertDiv.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <strong style="color: #ef4444; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
          <span>🔒</span> ${title}
        </strong>
        <button type="button" style="background: none; border: none; color: #a0aec0; font-size: 1.2rem; cursor: pointer; padding: 0 4px;" onclick="this.closest('#skysync-auth-floating-alert').remove()">✕</button>
      </div>
      <div style="color: #e2e8f0; font-size: 0.9rem;">${message}</div>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px;">
        <button type="button" style="background: #2d3748; color: #cbd5e0; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 0.85rem;" onclick="this.closest('#skysync-auth-floating-alert').remove()">Continuar Lendo sem Áudio</button>
        <a href="/api/v1/auth/login" style="background: #1db954; color: #000; font-weight: 700; text-decoration: none; padding: 8px 16px; border-radius: 6px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px;">🎧 Reconectar Spotify</a>
      </div>
    `;
    document.body.appendChild(alertDiv);
  }

  setOnStateChange(callback) {
    this.onStateChangeCallback = callback;
  }

  setOnTrackEnd(callback) {
    this.onTrackEndCallback = callback;
  }

  setOnError(callback) {
    this.onErrorCallback = callback;
  }
}

// Exporta globalmente para o ambiente do navegador
window.SpotifyAdapter = SpotifyAdapter;
