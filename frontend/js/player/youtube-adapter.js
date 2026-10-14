/**
 * Skysync - YouTube Adapter (Fase 9: Bugfixes de Playback, Limpeza de Decks e Crossfade Seguro)
 *
 * Arquitetura Dual-Deck (Deck A & Deck B) com travas de segurança anti-silêncio:
 * - Duração padrão unificada em 4000ms (4 segundos).
 * - Fim de Faixa (ENDED): Se a faixa atual já terminou ou está parada, não executa o cálculo
 *   de atenuação (gainOut); aplica imediatamente ganho total (gainIn = 100%) no novo deck,
 *   dispara playVideo() e desengata a trava isCrossfading sem atrasos de silêncio.
 * - Mecanismo de Limpeza e Fallback (_ensureActivePlaybackState): Garante explicitamente que
 *   ao término de qualquer transição ou carga direta, o deck ativo receba playVideo() e volume
 *   rigorosamente setado ao volume global (ex: 85%), enquanto o deck standby permanece zerado.
 */

class YouTubeAdapter {
  constructor() {
    this.name = 'youtube';
    this.deckAId = 'youtube-player-deck-a';
    this.deckBId = 'youtube-player-deck-b';
    this.fallbackContainerId = 'youtube-player-frame';

    this.playerA = null;
    this.playerB = null;
    this.isReadyA = false;
    this.isReadyB = false;

    // Deck ativo ('A' ou 'B')
    this.activeDeck = 'A';
    this.isPlayingTrack = false;
    this.currentTrack = null;
    this.queuedTrack = null;

    // Volume mestre padrão (0.0 a 1.0)
    this.volume = 0.85;

    // Gerenciador de animação de Crossfade (Padrão 4000ms)
    this.crossfadeInterval = null;
    this.isCrossfading = false;

    // Callbacks para o PlayerManager
    this.onStateChangeCallback = null;
    this.onTrackEndCallback = null;
  }

  /**
   * Inicializa a API do YouTube Iframe e monta os dois decks independentes.
   */
  init(containerId = 'youtube-player-deck-a') {
    return new Promise((resolve) => {
      const initBothPlayers = () => {
        let readyCount = 0;
        const checkDone = () => {
          readyCount++;
          if (readyCount >= 2 || (this.isReadyA && this.isReadyB)) {
            console.log('🎧 [Skysync YouTube Adapter] Dual-Deck pronto com travas de segurança (Deck A & B).');
            if (this.queuedTrack) {
              const track = this.queuedTrack;
              this.queuedTrack = null;
              this.loadTrack(track, true);
            }
            resolve();
          }
        };

        this._createPlayer('A', this.deckAId, checkDone);
        this._createPlayer('B', this.deckBId, checkDone);

        // Timeout de segurança caso a API demore a responder
        setTimeout(() => {
          if (!this.isReadyA && !this.isReadyB) {
            console.warn('[Skysync YouTube] Timeout na inicialização do YouTube API. Continuando com fallback.');
          }
          resolve();
        }, 3000);
      };

      if (window.YT && window.YT.Player) {
        initBothPlayers();
      } else {
        const prevCallback = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (typeof prevCallback === 'function') prevCallback();
          initBothPlayers();
        };

        if (!document.getElementById('yt-iframe-api-script')) {
          const tag = document.createElement('script');
          tag.id = 'yt-iframe-api-script';
          tag.src = 'https://www.youtube.com/iframe_api';
          const firstScriptTag = document.getElementsByTagName('script')[0];
          firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        }
      }
    });
  }

  /**
   * Cria o iframe isolado para o deck especificado ('A' ou 'B').
   */
  _createPlayer(deckName, elementId, onReadyDone) {
    let targetEl = document.getElementById(elementId);
    if (!targetEl) {
      targetEl = document.createElement('div');
      targetEl.id = elementId;
      targetEl.className = 'hidden-player-frame';
      targetEl.style.position = 'fixed';
      targetEl.style.bottom = '-100px';
      targetEl.style.left = '-100px';
      targetEl.style.width = '10px';
      targetEl.style.height = '10px';
      targetEl.style.opacity = '0.01';
      targetEl.style.pointerEvents = 'none';
      document.body.appendChild(targetEl);
    }

    const playerInstance = new window.YT.Player(elementId, {
      height: '10',
      width: '10',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        enablejsapi: 1,
        fs: 0,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        origin: window.location.origin,
      },
      events: {
        onReady: (event) => {
          if (deckName === 'A') {
            this.playerA = event.target;
            this.isReadyA = true;
            this.playerA.setVolume(Math.round(this.volume * 100));
          } else {
            this.playerB = event.target;
            this.isReadyB = true;
            this.playerB.setVolume(0); // Deck B inicia mutado para crossfade
          }
          console.log(`[Skysync YouTube] Deck ${deckName} inicializado com sucesso.`);
          onReadyDone();
        },
        onStateChange: (event) => {
          const isPlaying = event.data === window.YT.PlayerState.PLAYING;
          const isEnded = event.data === window.YT.PlayerState.ENDED; // 0 (Fim natural da música)

          // -------------------------------------------------------------
          // [TRAVA DE SEGURANÇA 1: DECK ATIVO & FIM DE FAIXA]
          // -------------------------------------------------------------
          if (this.activeDeck === deckName) {
            this.isPlayingTrack = isPlaying;

            // Se começou a tocar no deck ativo e não estamos em crossfade,
            // reforça o volume para evitar que o IFrame fique silencioso por reset interno
            if (isPlaying && !this.isCrossfading) {
              try {
                event.target.setVolume(Math.round(this.volume * 100));
              } catch (e) {}
            }

            // Fim natural da faixa: notifica imediatamente o PlayerManager
            if (isEnded) {
              this._cancelCrossfade();
              this.isPlayingTrack = false;
              console.log(
                `⏹️ [Skysync YouTube] Faixa no Deck ${deckName} finalizada naturalmente (ENDED: '${this.currentTrack?.title}').`
              );
              if (typeof this.onTrackEndCallback === 'function') {
                this.onTrackEndCallback(this.currentTrack);
              }
            }

            if (typeof this.onStateChangeCallback === 'function' && !this.isCrossfading) {
              this.onStateChangeCallback(isPlaying, event.data);
            }
          } else {
            // -------------------------------------------------------------
            // [TRAVA DE SEGURANÇA 2: DECK STANDBY SILENCIOSO]
            // Se o deck standby estiver emitindo áudio fora de crossfade, silencia e pausa
            // -------------------------------------------------------------
            if (isPlaying && !this.isCrossfading) {
              try {
                event.target.pauseVideo();
                event.target.setVolume(0);
              } catch (e) {}
            }
          }
        },
        onError: (err) => {
          console.warn(`[Skysync YouTube] Erro no Deck ${deckName}:`, err);
        },
      },
    });

    if (deckName === 'A') this.playerA = playerInstance;
    else this.playerB = playerInstance;
  }

  get activePlayer() {
    return this.activeDeck === 'A' ? this.playerA : this.playerB;
  }

  get standbyPlayer() {
    return this.activeDeck === 'A' ? this.playerB : this.playerA;
  }

  get isCurrentReady() {
    return this.activeDeck === 'A' ? this.isReadyA : this.isReadyB;
  }

  get isStandbyReady() {
    return this.activeDeck === 'A' ? this.isReadyB : this.isReadyA;
  }

  /**
   * MECANISMO DE LIMPEZA E FALLBACK (TRAVA DE SEGURANÇA CONTRA SILÊNCIO):
   * Requisito 3 da Fase 9:
   * Toda vez que um _loadDirect ou _performCrossfade terminar, garanta explicitamente que:
   * 1. O Deck Ativo receba a chamada playVideo() e volume setado rigorosamente ao volume global (ex: 85%).
   * 2. O Deck Standby seja pausado e seu volume seja zerado (evitando vazamentos ou concorrência).
   * 3. A trava isCrossfading seja desarmada (false) e isPlayingTrack seja true.
   * 4. Validação temporizada preventiva contra resets assíncronos do YouTube IFrame.
   */
  _ensureActivePlaybackState(reason = 'cleanup') {
    this._cancelCrossfade();

    const active = this.activePlayer;
    const standby = this.standbyPlayer;
    const targetMasterPercent = Math.round(this.volume * 100);

    // [TRAVA DE SEGURANÇA - STANDBY]: Sempre pausado e zerado
    try {
      if (standby) {
        if (typeof standby.pauseVideo === 'function') standby.pauseVideo();
        if (typeof standby.setVolume === 'function') standby.setVolume(0);
      }
    } catch (e) {
      console.warn('[Skysync YouTube Safety] Erro ao silenciar standby:', e);
    }

    // [TRAVA DE SEGURANÇA - ATIVO]: Força volume global e playVideo()
    try {
      if (active) {
        if (typeof active.setVolume === 'function') {
          active.setVolume(targetMasterPercent);
        }
        if (typeof active.playVideo === 'function') {
          active.playVideo();
        }
      }
    } catch (e) {
      console.warn('[Skysync YouTube Safety] Erro ao reativar deck ativo:', e);
    }

    this.isPlayingTrack = true;
    this.isCrossfading = false;

    // [TRAVA DE SEGURANÇA - CONFIRMAÇÃO TEMPORIZADA]:
    // A API do YouTube pode repor o volume em 0 durante o buffering inicial do novo vídeo.
    // Esta checagem aos 200ms garante que o volume permaneça estritamente no alvo.
    setTimeout(() => {
      try {
        if (this.activePlayer && !this.isCrossfading && this.isPlayingTrack) {
          if (typeof this.activePlayer.setVolume === 'function') {
            this.activePlayer.setVolume(targetMasterPercent);
          }
          if (typeof this.activePlayer.playVideo === 'function') {
            this.activePlayer.playVideo();
          }
        }
      } catch (e) {}
    }, 200);

    console.log(
      `🛡️ [Skysync YouTube Safety] Limpeza concluída (${reason}): Deck ${this.activeDeck} @ ${targetMasterPercent}%, Standby zerado.`
    );
  }

  /**
   * Carrega e reproduz uma faixa musical com crossfade padrão de 4000ms.
   */
  loadTrack(trackData, autoplay = true, fadeDurationMs = 4000) {
    const ytData = trackData?.providers?.youtube;
    if (!ytData || !ytData.video_id) {
      console.warn('[Skysync YouTube] Faixa sem video_id do YouTube:', trackData);
      return;
    }

    const videoId = ytData.video_id;
    const startSeconds = ytData.start_seconds || 0;

    // Se os reprodutores ainda não inicializaram, enfileira
    if (!this.isReadyA && !this.isReadyB) {
      console.log(`[Skysync YouTube] Enfileirando faixa para quando os decks carregarem: ${videoId}`);
      this.queuedTrack = trackData;
      return;
    }

    const previousTrack = this.currentTrack;
    this.currentTrack = trackData;

    // Se não for para autoplay, apenas prepara sem reproduzir
    if (!autoplay) {
      this._loadDirect(trackData, videoId, false);
      return;
    }

    // Se ambos os decks estiverem prontos, aciona a máquina inteligente de crossfade
    if (this.isStandbyReady && this.isCurrentReady) {
      console.log(
        `🔀 [Skysync YouTube] Transição de '${previousTrack?.title || 'Silêncio'}' para '${trackData.title}' (Fade: ${fadeDurationMs}ms)...`
      );
      this._performCrossfade(videoId, startSeconds, fadeDurationMs);
      return;
    }

    // Fallback se apenas um deck estiver operacional
    this._loadDirect(trackData, videoId, true);
  }

  /**
   * Executa a transição entre Decks com tratamento especial para faixas terminadas (ENDED)
   * e atenuação Equal-Power para faixas em reprodução ativa (4000ms padrão).
   */
  _performCrossfade(nextVideoId, nextStartSeconds, durationMs = 4000) {
    this._cancelCrossfade();

    const outgoingDeckName = this.activeDeck;
    const incomingDeckName = this.activeDeck === 'A' ? 'B' : 'A';
    const outgoingPlayer = this.activePlayer;
    const incomingPlayer = this.standbyPlayer;

    const targetMasterVolume = this.volume;
    const targetMasterPercent = Math.round(targetMasterVolume * 100);

    // -------------------------------------------------------------
    // [SOLUÇÃO REQUISITO 2: CORREÇÃO DO BUG DE FIM DE FAIXA (ENDED)]
    // Verifica se a música atual já está terminada, pausada ou sem áudio ativo.
    // -------------------------------------------------------------
    let isCurrentEndedOrStopped = !this.isPlayingTrack;
    if (outgoingPlayer && typeof outgoingPlayer.getPlayerState === 'function') {
      try {
        const state = outgoingPlayer.getPlayerState();
        if (
          state === window.YT.PlayerState.ENDED ||
          state === window.YT.PlayerState.PAUSED ||
          state === window.YT.PlayerState.UNSTARTED ||
          state === window.YT.PlayerState.CUED
        ) {
          isCurrentEndedOrStopped = true;
        }
      } catch (e) {}
    }

    // Se a música atual já estiver terminada/parada:
    // NÃO faça o cálculo de ganho de saída (gainOut) nem espere 4 segundos no silêncio!
    // Apenas garanta que o novo deck receba o volume total (gainIn = 100%),
    // inicie o playVideo() e libere a trava isCrossfading imediatamente.
    if (isCurrentEndedOrStopped) {
      console.log(
        `⚡ [Skysync YouTube Safety] Faixa anterior já terminada (ENDED/PAUSED). ` +
        `Aplicando ganho total imediato no Deck ${incomingDeckName} sem atenuação gainOut.`
      );

      // 1. Silencia e pausa outgoingPlayer
      try {
        if (outgoingPlayer) {
          if (typeof outgoingPlayer.pauseVideo === 'function') outgoingPlayer.pauseVideo();
          if (typeof outgoingPlayer.setVolume === 'function') outgoingPlayer.setVolume(0);
        }
      } catch (e) {}

      // 2. Prepara o incomingPlayer com volume total e inicia reprodução
      try {
        if (incomingPlayer) {
          incomingPlayer.setVolume(targetMasterPercent);
          incomingPlayer.loadVideoById({
            videoId: nextVideoId,
            startSeconds: nextStartSeconds,
          });
          incomingPlayer.playVideo();
        }
      } catch (err) {
        console.warn('[Skysync YouTube] Falha ao carregar incomingPlayer pós-ended:', err);
      }

      // 3. Alterna o deck ativo e executa limpeza completa anti-silêncio
      this.activeDeck = incomingDeckName;
      this._ensureActivePlaybackState('ended_track_fast_forward');

      if (typeof this.onStateChangeCallback === 'function') {
        this.onStateChangeCallback(true);
      }
      return;
    }

    // -------------------------------------------------------------
    // [TRANSICÃO EQUAL-POWER DUAL-DECK (MÚSICA ATIVA TOCANDO)]
    // -------------------------------------------------------------
    this.isCrossfading = true;

    const stepIntervalMs = 50; // Intervalo suave de 50ms
    const totalSteps = Math.max(10, Math.round(durationMs / stepIntervalMs));
    let currentStep = 0;

    // 1. Prepara o Deck Entrante no volume 0 e dispara a reprodução imediata
    try {
      incomingPlayer.setVolume(0);
      incomingPlayer.loadVideoById({
        videoId: nextVideoId,
        startSeconds: nextStartSeconds,
      });
      incomingPlayer.playVideo();
    } catch (err) {
      console.warn('[Skysync YouTube] Falha ao iniciar Deck Entrante no crossfade:', err);
      // Fallback seguro: alterna de uma vez com o mecanismo de segurança
      this.activeDeck = incomingDeckName;
      this._ensureActivePlaybackState('crossfade_fallback');
      return;
    }

    // 2. Curva Equal-Power (Senoide acústica para manter a sensação constante de volume)
    this.crossfadeInterval = setInterval(() => {
      currentStep++;
      const progress = Math.min(1, currentStep / totalSteps);

      // fadeOutFactor: cos(progress * π / 2) -> 1.0 a 0.0
      // fadeInFactor:  sin(progress * π / 2) -> 0.0 a 1.0
      const fadeOutFactor = Math.cos((progress * Math.PI) / 2);
      const fadeInFactor = Math.sin((progress * Math.PI) / 2);

      const outVol = Math.round(targetMasterPercent * fadeOutFactor);
      const inVol = Math.round(targetMasterPercent * fadeInFactor);

      try {
        if (outgoingPlayer && typeof outgoingPlayer.setVolume === 'function') outgoingPlayer.setVolume(outVol);
        if (incomingPlayer && typeof incomingPlayer.setVolume === 'function') incomingPlayer.setVolume(inVol);
      } catch (e) {}

      // 3. Fim da transição (4 segundos)
      if (progress >= 1) {
        this._cancelCrossfade();

        // Alterna o papel do deck ativo para o novo deck
        this.activeDeck = incomingDeckName;

        // [TRAVA DE SEGURANÇA 3: LIMPEZA COMPLETA PÓS-CROSSFADE]
        // Garante rigorosamente playVideo(), volume global e destravamento
        this._ensureActivePlaybackState('crossfade_completed');

        console.log(
          `✨ [Skysync YouTube] Crossfade de ${durationMs}ms concluído com sucesso! Deck ${this.activeDeck} ativo em ${targetMasterPercent}%.`
        );

        if (typeof this.onStateChangeCallback === 'function') {
          this.onStateChangeCallback(true);
        }
      }
    }, stepIntervalMs);
  }

  /**
   * Alias de compatibilidade com chamadas anteriores
   */
  _performDualDeckCrossfade(nextVideoId, nextStartSeconds, durationMs = 4000) {
    return this._performCrossfade(nextVideoId, nextStartSeconds, durationMs);
  }

  /**
   * Carga direta sem crossfade (usado no início inicial ou quando apenas um deck está operacional)
   */
  _loadDirect(track, videoId, autoPlay = true) {
    this._cancelCrossfade();
    this.currentTrack = track;
    const startSec = track.providers?.youtube?.start_seconds || 0;
    const targetVolumePercent = Math.round(this.volume * 100);

    const player = this.activePlayer;
    if (!player || !player.loadVideoById) {
      if (this.standbyPlayer && this.standbyPlayer.loadVideoById) {
        this.activeDeck = this.activeDeck === 'A' ? 'B' : 'A';
      } else {
        console.warn('[Skysync YouTube] Nenhum player pronto para carga direta.');
        return;
      }
    }

    const active = this.activePlayer;
    if (autoPlay) {
      try {
        active.loadVideoById({ videoId, startSeconds: startSec });
      } catch (e) {
        console.warn('[Skysync YouTube] Falha ao carregar loadVideoById:', e);
      }

      // [TRAVA DE SEGURANÇA 4: LIMPEZA E GARANTIA IMEDIATA DE REPRODUÇÃO NO LOAD DIRETO]
      this._ensureActivePlaybackState('load_direct_auto');
    } else {
      try {
        active.cueVideoById({ videoId, startSeconds: startSec });
        active.setVolume(targetVolumePercent);
      } catch (e) {}
      this.isPlayingTrack = false;
    }
  }

  /**
   * Cancela qualquer timer de crossfade ativo e desengata a trava
   */
  _cancelCrossfade() {
    if (this.crossfadeInterval) {
      clearInterval(this.crossfadeInterval);
      this.crossfadeInterval = null;
    }
    this.isCrossfading = false;
  }

  play() {
    this._ensureActivePlaybackState('manual_play');
  }

  pause() {
    this._cancelCrossfade();
    try {
      if (this.activePlayer && typeof this.activePlayer.pauseVideo === 'function') {
        this.activePlayer.pauseVideo();
      }
      if (this.standbyPlayer && typeof this.standbyPlayer.pauseVideo === 'function') {
        this.standbyPlayer.pauseVideo();
      }
    } catch (e) {
      console.warn('[Skysync YouTube] Erro ao pausar:', e);
    }
    this.isPlayingTrack = false;
  }

  setVolume(volumeFloat) {
    this.volume = Math.max(0, Math.min(1, volumeFloat));
    if (!this.isCrossfading && this.activePlayer && typeof this.activePlayer.setVolume === 'function') {
      try {
        this.activePlayer.setVolume(Math.round(this.volume * 100));
      } catch (e) {
        console.warn('[Skysync YouTube] Erro ao ajustar volume:', e);
      }
    }
  }

  isPlaying() {
    return this.isPlayingTrack;
  }

  setOnStateChange(callback) {
    this.onStateChangeCallback = callback;
  }

  setOnTrackEnd(callback) {
    this.onTrackEndCallback = callback;
  }
}

// Exporta globalmente para o navegador
window.YouTubeAdapter = YouTubeAdapter;
