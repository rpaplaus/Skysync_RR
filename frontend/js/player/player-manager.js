/**
 * Skysync - PlayerManager (Fase 23: Fade-out Cinematográfico de 4 Segundos e Fade-in Suave)
 * 
 * Orquestrador oficial do player Spotify com Web Playback SDK:
 * 1. Startup Exato: O aplicativo não sorteia rádio ambiente no início. O Capítulo 1
 *    começa tocando imediatamente o gatilho oficial "Handle With Care - Traveling Wilburys".
 * 2. Transições Seguras e Fim Natural: Validação por URI e trava no adapter garantem
 *    que o evento ENDED só dispare no fim real da música, acionando a Rádio Ambiente.
 * 3. Fade-Out Rigoroso de 4 Segundos (4000ms): Ao disparar um gatilho de cena, o volume
 *    é reduzido gradualmente até 0% antes de emitir a troca de faixa.
 * 4. Fade-In Suave (2 a 3 segundos, 2500ms): Logo após a nova faixa confirmar o playback,
 *    o volume sobe gradativamente até o volume alvo do usuário.
 * 5. Bloqueio de Condições de Corrida (Race Conditions): Trocas rápidas de página cancelam
 *    imediatamente os intervalos anteriores e iniciam a rampa a partir do volume atual em tempo real.
 */

const DEFAULT_AMBIENT_TRACKS = [
  {
    id: 'track-hey-thats-no-way-to-say-goodbye',
    title: "Hey, That's No Way to Say Goodbye",
    artist: 'Leonard Cohen',
    role: 'ambient',
    providers: {
      spotify: {
        uri: 'spotify:track:4Hu4Cg35qxh3Uz7PAGj8de',
        id: '4Hu4Cg35qxh3Uz7PAGj8de',
      },
    },
    default_playback_options: { fade_in_ms: 2500, fade_out_ms: 4000, volume: 0.85, loop: false },
  },
  {
    id: 'track-sundown',
    title: 'Sundown',
    artist: 'Gordon Lightfoot',
    role: 'ambient',
    providers: {
      spotify: {
        uri: 'spotify:track:0SjnBEHZVXgCKvOrpvzL2k',
        id: '0SjnBEHZVXgCKvOrpvzL2k',
      },
    },
    default_playback_options: { fade_in_ms: 2500, fade_out_ms: 4000, volume: 0.85, loop: false },
  },
  {
    id: 'track-rosanna',
    title: 'Rosanna',
    artist: 'TOTO',
    role: 'ambient',
    providers: {
      spotify: {
        uri: 'spotify:track:37BTh5g05cxBIRYMbw8g2T',
        id: '37BTh5g05cxBIRYMbw8g2T',
      },
    },
    default_playback_options: { fade_in_ms: 2500, fade_out_ms: 4000, volume: 0.85, loop: false },
  },
  {
    id: 'track-youre-my-best-friend',
    title: "You're My Best Friend",
    artist: 'Queen',
    role: 'ambient',
    providers: {
      spotify: {
        uri: 'spotify:track:46gybz6M2g4oiVvt1aWOV4',
        id: '46gybz6M2g4oiVvt1aWOV4',
      },
    },
    default_playback_options: { fade_in_ms: 2500, fade_out_ms: 4000, volume: 0.85, loop: false },
  },
  {
    id: 'track-wish-you-were-here',
    title: 'Wish You Were Here',
    artist: 'Pink Floyd',
    role: 'ambient',
    providers: {
      spotify: {
        uri: 'spotify:track:6mFkJmJqdDVQ1REhVfGgd1',
        id: '6mFkJmJqdDVQ1REhVfGgd1',
      },
    },
    default_playback_options: { fade_in_ms: 2500, fade_out_ms: 4000, volume: 0.85, loop: false },
  },
];

const DEFAULT_INITIAL_TRACK = {
  id: 'track-handle-with-care',
  title: 'Handle With Care',
  artist: 'Traveling Wilburys',
  album: 'The Traveling Wilburys, Vol. 1',
  role: 'trigger',
  providers: {
    spotify: {
      uri: 'spotify:track:1G0ku3TLCGwrAHj9WPudKX',
      id: '1G0ku3TLCGwrAHj9WPudKX',
    },
  },
  default_playback_options: { fade_in_ms: 2500, fade_out_ms: 4000, volume: 0.85, loop: false },
};

class PlayerManager {
  constructor() {
    this.STORAGE_KEYS = {
      LAST_TRACK_ID: 'skysync_last_track_id',
      VOLUME: 'skysync_volume',
    };

    // Adaptador exclusivo oficial: Spotify Web Playback SDK
    this.adapter = new window.SpotifyAdapter();
    this.activeProviderName = 'spotify';

    this.currentTrack = null;
    // Correção 3: NUNCA salve nem leia isManuallyPaused do localStorage. Sempre inicie com false.
    this.isManuallyPaused = false;
    this.pausedOnCurrentPage = false;
    this.currentPageIndex = null;
    this.currentChapterId = null;
    localStorage.removeItem('skysync_manual_pause');
    this.volume = parseFloat(localStorage.getItem(this.STORAGE_KEYS.VOLUME)) || 0.85;

    // Catálogo e Rádio Ambiente
    this.fullCatalog = {};
    this.ambientTracks = [];
    this.lastAmbientTrackId = null;

    // Requisito 3: Gerenciador rigoroso de timer de gatilho Lookahead
    this.pendingTriggerTimer = null;
    this.pendingTriggerBlockId = null;
    this.pendingTriggerTrack = null;

    // Failsafes de debounce e prevenção de loops
    this.consecutiveErrorCount = 0;
    this.errorCooldownTimer = null;
    this.lastTrackEndTime = 0;

    // Elementos da UI
    this.ui = {
      btnPlayPause: null,
      trackTitle: null,
      trackArtist: null,
      soundwave: null,
      volumeSlider: null,
      hudActiveTrack: null,
    };
  }

  /**
   * Inicializa catálogo, adaptador Spotify, escuta de eventos e UI.
   */
  async init() {
    console.log('🎧 [Skysync PlayerManager] Inicializando Player 100% Exclusivo Spotify (Fase 15)...');
    this._bindUIElements();

    // 1. Carrega catálogo limpo de trilhas do backend
    await this._loadCatalog();

    // 2. Prepara o adaptador Spotify Web Playback SDK (sem connect prematuro)
    await this.adapter.init();

    // 3. Configura callbacks de estado de reprodução, fim de faixa e tratamento de erros
    this.adapter.setOnStateChange((isPlaying) => this._onPlayerStateChanged(isPlaying));
    this.adapter.setOnTrackEnd((endedTrack) => this.handleTrackEnded(endedTrack));
    this.adapter.setOnError((err, track) => this.handleTrackError(err, track));

    // 4. Ajusta volume inicial
    this.setVolume(this.volume);

    // 5. Escuta evento disparado pelo leitor para Lookahead Trigger
    window.addEventListener('skysync:paragraph-change', (event) => {
      this.handleParagraphChange(event.detail);
    });

    this._updateUI();
    console.log(
      `🎧 [Skysync PlayerManager] Pronto. Provedor: SPOTIFY PREMIUM ` +
      `| Faixas ambiente catalogadas: ${this.ambientTracks.length}`
    );
  }

  get activeAdapter() {
    return this.adapter;
  }

  /**
   * Conecta o Spotify SDK sob demanda após interação do usuário (AudioContext unlock).
   */
  async connect() {
    if (this.adapter && typeof this.adapter.connect === 'function') {
      return await this.adapter.connect();
    }
    return null;
  }

  /**
   * Carrega o catálogo da API e filtra as faixas ambientais para Spotify.
   */
  async _loadCatalog() {
    try {
      const res = await fetch('/api/v1/tracks/catalog');
      if (res.ok) {
        const catalog = await res.json();
        this.fullCatalog = catalog;

        // Filtra faixas ambientais oficiais com URI do Spotify
        const ambients = Object.values(catalog).filter(
          (t) => t.role === 'ambient' && (t.providers?.spotify?.uri || t.providers?.spotify?.id)
        );

        if (ambients.length > 0) {
          this.ambientTracks = ambients;
        } else {
          this.ambientTracks = [...DEFAULT_AMBIENT_TRACKS];
        }

        console.log(`📻 [Skysync Catálogo] ${this.ambientTracks.length} faixas ambient Spotify catalogadas.`);
      }
    } catch (e) {
      console.warn('[Skysync PlayerManager] Falha ao carregar catálogo de faixas:', e);
      this.ambientTracks = [...DEFAULT_AMBIENT_TRACKS];
    }
  }

  /**
   * Localiza uma música no catálogo por título, artista ou ID.
   */
  findTrack(titleOrId, artistHint) {
    if (!this.fullCatalog || Object.keys(this.fullCatalog).length === 0) return null;

    // 1. Busca direta por chave
    if (this.fullCatalog[titleOrId]) {
      return this.fullCatalog[titleOrId];
    }

    const searchLower = titleOrId.toLowerCase().trim();
    const artistLower = artistHint ? artistHint.toLowerCase().trim() : '';

    // 2. Busca por id, título ou slug
    for (const track of Object.values(this.fullCatalog)) {
      if (track.id === titleOrId || track.id === searchLower) {
        return track;
      }
      const tTitle = track.title?.toLowerCase() || '';
      if (tTitle === searchLower || (searchLower.length >= 4 && tTitle.includes(searchLower))) {
        if (!artistLower || (track.artist && track.artist.toLowerCase().includes(artistLower))) {
          return track;
        }
      }
    }

    return null;
  }

  /**
   * Requisito 4: Regra de Ouro do Início da Leitura.
   * Ao clicar em "Iniciar Leitura" (seja do início do livro ou no Capítulo 1 / Prefácio),
   * a primeira música a tocar DEVE SER OBRIGATORIAMENTE a primeira música de gatilho:
   * "Handle With Care" - Traveling Wilburys (track-handle-with-care), com autoplay = true.
   * Fase 23: Início direto sem fade-out prévio (volume em 0%), seguido de fade-in suave de 2500ms.
   */
  async playInitialTrack() {
    console.log('🚀 [Skysync Startup] Iniciando leitura: acionando trilha oficial obrigatória (Handle With Care)...');
    this.isManuallyPaused = false;
    this.pausedOnCurrentPage = false;

    // Busca especificamente "Handle With Care" dos "Traveling Wilburys"
    let initialTrack =
      this.findTrack('track-handle-with-care') ||
      this.findTrack('Handle With Care', 'Traveling Wilburys') ||
      DEFAULT_INITIAL_TRACK;

    console.log(
      `🚀 [Skysync Startup] Tocando faixa oficial obrigatória de abertura: '${initialTrack.title}' (${initialTrack.artist})`
    );
    return await this.playTrack(initialTrack, true, 2500, 0);
  }

  /**
   * Reproduz uma faixa explicitamente com controle refinado de Fade-In e Fade-Out Cinematográfico (Fase 23).
   * 
   * @param {Object} track - Objeto da faixa
   * @param {boolean} autoplay - Se true, inicia playback
   * @param {number} fadeInDurationMs - Duração do fade-in (2000ms a 3000ms, padrão 2500ms)
   * @param {number} fadeOutDurationMs - Duração do fade-out rigoroso (padrão 4000ms)
   */
  async playTrack(track, autoplay = true, fadeInDurationMs = 2500, fadeOutDurationMs = 4000) {
    if (!track) return;

    this.currentTrack = track;
    localStorage.setItem(this.STORAGE_KEYS.LAST_TRACK_ID, track.id);

    this._updateUI(autoplay);
    return await this.adapter.loadTrack(track, autoplay, fadeInDurationMs, fadeOutDurationMs);
  }

  /**
   * Sorteia uma música aleatória da lista ambient sem repetir a anterior consecutivamente.
   */
  getRandomAmbientTrack() {
    let candidates =
      this.ambientTracks && this.ambientTracks.length > 0
        ? this.ambientTracks.filter((t) => t.role === 'ambient' && (t.providers?.spotify?.uri || t.providers?.spotify?.id))
        : [];

    if (candidates.length === 0) {
      this.ambientTracks = [...DEFAULT_AMBIENT_TRACKS];
      candidates = this.ambientTracks;
    }

    if (candidates.length > 1 && this.lastAmbientTrackId) {
      const withoutLast = candidates.filter((t) => t.id !== this.lastAmbientTrackId);
      if (withoutLast.length > 0) {
        candidates = withoutLast;
      }
    }

    const randomIndex = Math.floor(Math.random() * candidates.length);
    const selected = candidates[randomIndex];
    this.lastAmbientTrackId = selected.id;
    return selected;
  }

  /**
   * Inicia ou faz transição para uma nova faixa da Rádio Ambiente (Fase 23).
   * Padrão: 4000ms fade-out se houver faixa audível tocando, e 2500ms fade-in.
   */
  playRandomAmbientTrack(fadeInDurationMs = 2500, fadeOutDurationMs = 4000) {
    if (this.isManuallyPaused) {
      console.log('[Skysync Player] Rádio Ambiente não acionada: usuário pausou manualmente.');
      return;
    }

    const ambientTrack = this.getRandomAmbientTrack();
    if (!ambientTrack) {
      console.warn('[Skysync Player] Nenhuma faixa ambiente disponível para sorteio.');
      return;
    }

    console.log(
      `📻 [Skysync Rádio Ambiente Spotify] Tocando: '${ambientTrack.title}' (Fade-Out: ${fadeOutDurationMs}ms, Fade-In: ${fadeInDurationMs}ms)`
    );

    return this.playTrack(ambientTrack, true, fadeInDurationMs, fadeOutDurationMs);
  }

  /**
   * Dispara a reprodução ao entrar no modo de leitura (respeitando startup vs resume).
   */
  async playAmbientTrack() {
    this.isManuallyPaused = false;
    this.pausedOnCurrentPage = false;

    if (!this.ambientTracks || this.ambientTracks.length === 0) {
      await this._loadCatalog();
    }

    if (this.adapter && typeof this.adapter.connect === 'function' && !this.adapter.isReady) {
      await this.adapter.connect();
    }

    // Se já estiver tocando uma faixa (ex: do Startup), não interrompe
    if (this.adapter.isPlaying() && this.currentTrack) {
      console.log(`🎧 [Skysync Player] Mantendo faixa ativa em reprodução: '${this.currentTrack.title}'`);
      return;
    }

    return this.playRandomAmbientTrack(2500, 4000);
  }

  /**
   * Tratamento de fim de faixa natural (Achado D refatorado).
   * O adapter garante que o callback só dispara quando a música acaba de verdade.
   * Fase 23: Como a faixa anterior já encerrou o áudio, fade-out é 0ms e fade-in é 2500ms.
   */
  handleTrackEnded(endedTrack) {
    const trackTitle = endedTrack?.title || this.currentTrack?.title || 'Faixa';
    const trackRole = endedTrack?.role || this.currentTrack?.role || 'trigger';

    // Debounce adicional de 2.5s contra disparos em cascata
    const now = Date.now();
    if (this.lastTrackEndTime && now - this.lastTrackEndTime < 2500) {
      return;
    }
    this.lastTrackEndTime = now;

    console.log(
      `⏹️ [Skysync PlayerManager] Fim natural da faixa detectado: '${trackTitle}' (role: ${trackRole}). ` +
      `Ativando Rádio Ambiente Spotify com fade-in suave (2500ms, sem espera de fade-out)...`
    );

    if (this.isManuallyPaused) {
      console.log('[Skysync Player] Transição automática ignorada: usuário pausou manualmente.');
      return;
    }

    this.playRandomAmbientTrack(2500, 0);
  }

  /**
   * Fade-out cinematográfico direto via adaptador (Fase 23).
   * Reduz o volume do nível atual até 0% em durationMs (padrão 4000ms).
   */
  async fadeOut(durationMs = 4000, stepMs = 100) {
    if (this.adapter && typeof this.adapter.fadeOut === 'function') {
      return await this.adapter.fadeOut(durationMs, stepMs);
    }
    return false;
  }

  /**
   * Fade-in suave direto via adaptador (Fase 23).
   * Eleva o volume de 0% até o nível configurado pelo usuário em durationMs (padrão 2500ms).
   */
  async fadeIn(durationMs = 2500, stepMs = 100) {
    if (this.adapter && typeof this.adapter.fadeIn === 'function') {
      return await this.adapter.fadeIn(durationMs, stepMs);
    }
    return false;
  }

  /**
   * Tratamento de Erros:
   * Em caso de falha no carregamento ou playback, pula para a próxima faixa ambient de forma segura.
   */
  handleTrackError(err, failedTrack) {
    const title = failedTrack?.title || this.currentTrack?.title || 'Faixa';
    console.warn(`🚨 [Skysync PlayerManager] Erro no player para faixa '${title}' (Erro: ${err}).`);

    this.cancelPendingTrigger();

    // Requisito 4 (Fase 18: Limpeza de Erros e Pulos):
    // Se for erro crítico de autenticação/permissão/token/premium, NUNCA tenta outra música em loop!
    const errStr = String(err).toLowerCase();
    if (
      err === 'auth_error' ||
      err === 'premium_required' ||
      err === 'auth_missing' ||
      err === 'play_failed_401' ||
      err === 'play_failed_403' ||
      errStr.includes('auth') ||
      errStr.includes('premium') ||
      errStr.includes('token')
    ) {
      console.warn(`🔒 [Skysync PlayerManager] Erro crítico de permissão/auth ('${err}'). Bloqueando repetição em loop.`);
      if (this.errorCooldownTimer) {
        clearTimeout(this.errorCooldownTimer);
        this.errorCooldownTimer = null;
      }
      this.consecutiveErrorCount = 0;
      this.isManuallyPaused = true;
      this._updateUI(false);
      return;
    }

    if (failedTrack && failedTrack.id && failedTrack.role === 'ambient') {
      this.lastAmbientTrackId = failedTrack.id;
      this.ambientTracks = this.ambientTracks.filter((t) => t.id !== failedTrack.id);
    }

    if (!this.ambientTracks || this.ambientTracks.length === 0) {
      this.ambientTracks = [...DEFAULT_AMBIENT_TRACKS];
    }

    if (this.isManuallyPaused) {
      this._updateUI(false);
      return;
    }

    this.consecutiveErrorCount = (this.consecutiveErrorCount || 0) + 1;
    if (this.consecutiveErrorCount >= 4) {
      console.warn('⚠️ [Skysync PlayerManager] Limite de tentativas consecutivas atingido (4). Aguardando próxima ação.');
      this._updateUI(false);
      return;
    }

    if (this.errorCooldownTimer) {
      clearTimeout(this.errorCooldownTimer);
    }
    this.errorCooldownTimer = setTimeout(() => {
      this.errorCooldownTimer = null;
      if (!this.isManuallyPaused) {
        console.log(`🔄 [Skysync PlayerManager] Tentativa ${this.consecutiveErrorCount}/4: sorteando nova faixa ambient...`);
        this.playRandomAmbientTrack(2500, 0);
      }
    }, 800);
  }

  /**
   * Cancela qualquer timer pendente de gatilho e limpa as referências.
   */
  cancelPendingTrigger() {
    if (this.pendingTriggerTimer) {
      clearTimeout(this.pendingTriggerTimer);
      this.pendingTriggerTimer = null;
    }
    this.pendingTriggerBlockId = null;
    this.pendingTriggerTrack = null;
  }

  /**
   * Lookahead Exato e Bloqueio de Overlap (Fase 16 / Fase 23).
   * Trata gatilhos recebidos de mudanças de página ou cliques em badges.
   */
  handleParagraphChange(detail) {
    const { paragraphId, chapterId, pageIndex, audioTrigger } = detail || {};

    // Virada de página: reseta estado de pause da página anterior
    if (
      (pageIndex !== undefined && pageIndex !== this.currentPageIndex) ||
      (chapterId !== undefined && chapterId !== this.currentChapterId)
    ) {
      this.currentPageIndex = pageIndex !== undefined ? pageIndex : this.currentPageIndex;
      this.currentChapterId = chapterId !== undefined ? chapterId : this.currentChapterId;
      this.pausedOnCurrentPage = false;
    }

    if (!audioTrigger || !audioTrigger.track) {
      this.cancelPendingTrigger();
      return;
    }

    // Cópia rasa forçando role: 'trigger' sem mutar o catálogo
    const newTrack = { ...audioTrigger.track, role: 'trigger' };

    // Guarda contra duplicatas: se a faixa já estiver tocando, mantém
    if (this.currentTrack && this.currentTrack.id === newTrack.id) {
      return;
    }

    // Cancela qualquer timer pendente para agendar com o delay atual
    this.cancelPendingTrigger();

    const delayMs = audioTrigger.delay_ms ?? 1000;

    this.pendingTriggerBlockId = paragraphId;
    this.pendingTriggerTrack = newTrack;

    console.log(
      `🎧 [Skysync Player Lookahead] Gatilho de cena detectado: '${newTrack.title}' (${newTrack.artist}). ` +
      `Aguardando delay de ${delayMs}ms...`
    );

    this.pendingTriggerTimer = setTimeout(() => {
      this._executeTrigger({ ...audioTrigger, track: newTrack }, paragraphId);
    }, delayMs);
  }

  /**
   * Executa a transição definitiva para a faixa de cena disparada (Fase 23: Fade-out Cinematográfico 4000ms + Fade-in 2500ms).
   * Um gatilho de cena na virada de página sempre toca, a menos que o usuário tenha pausado explicitamente na página atual.
   */
  _executeTrigger(audioTrigger, paragraphId) {
    const track = { ...audioTrigger.track, role: 'trigger' };

    this.pendingTriggerTimer = null;
    this.pendingTriggerBlockId = null;
    this.pendingTriggerTrack = null;

    console.log(
      `🔀 [Skysync Spotify] Disparando trilha de cena: '${track.title}' (${track.artist}) ` +
      `[Fade-Out Cinematográfico: 4000ms -> Play -> Fade-In: 2500ms]`
    );

    if (this.pausedOnCurrentPage) {
      console.log('⏸️ [Skysync Player] Gatilho mantido pausado: usuário pausou explicitamente na página atual.');
      this.playTrack(track, false, 2500, 4000);
      return;
    }

    this.isManuallyPaused = false;
    this.playTrack(track, true, 2500, 4000);
  }

  /**
   * Botão Global de Play/Pause na interface.
   */
  togglePlayPause() {
    // Desbloqueio síncrono nativo no gesto do usuário
    if (this.adapter && typeof this.adapter.unlockAudio === 'function') {
      this.adapter.unlockAudio();
    }

    const isPlaying = this.adapter.isPlaying();

    if (isPlaying) {
      this.adapter.pause();
      this.isManuallyPaused = true;
      this.pausedOnCurrentPage = true;
      console.log('[Skysync Player] Reprodução pausada pelo usuário.');
      this._updateUI(false);
    } else {
      this.isManuallyPaused = false;
      this.pausedOnCurrentPage = false;
      this.consecutiveErrorCount = 0;
      console.log('[Skysync Player] Reprodução retomada pelo usuário.');

      if (this.adapter && typeof this.adapter.connect === 'function' && !this.adapter.isReady) {
        this.adapter.connect().then(() => {
          if (this.currentTrack) {
            this.adapter.play();
            this._updateUI(true);
          } else {
            this.playInitialTrack();
          }
        });
        return;
      }

      if (this.currentTrack) {
        this.adapter.play();
        this._updateUI(true);
      } else {
        this.playInitialTrack();
      }
    }
  }

  /**
   * Altera o volume do reprodutor.
   */
  setVolume(volFloat) {
    this.volume = Math.max(0, Math.min(1, volFloat));
    localStorage.setItem(this.STORAGE_KEYS.VOLUME, this.volume.toString());
    this.adapter.setVolume(this.volume);
    if (this.ui.volumeSlider) {
      this.ui.volumeSlider.value = Math.round(this.volume * 100);
    }
  }

  /**
   * Vincula referências dos elementos visuais do HUD do player.
   */
  _bindUIElements() {
    this.ui.btnPlayPause = document.getElementById('btn-player-play');
    this.ui.trackTitle = document.getElementById('player-track-title');
    this.ui.trackArtist = document.getElementById('player-track-artist');
    this.ui.soundwave = document.getElementById('player-soundwave');
    this.ui.volumeSlider = document.getElementById('player-volume-slider');
    this.ui.hudActiveTrack = document.getElementById('hud-active-track');

    if (this.ui.btnPlayPause) {
      this.ui.btnPlayPause.addEventListener('click', () => this.togglePlayPause());
    }

    if (this.ui.volumeSlider) {
      this.ui.volumeSlider.value = Math.round(this.volume * 100);
      this.ui.volumeSlider.addEventListener('input', (e) => {
        this.setVolume(parseInt(e.target.value, 10) / 100);
      });
    }
  }

  /**
   * Atualiza a UI refletindo o estado de reprodução.
   */
  _updateUI(isPlayingOverride) {
    const isPlaying =
      typeof isPlayingOverride === 'boolean'
        ? isPlayingOverride
        : this.adapter.isPlaying();

    // Botão Play/Pause
    if (this.ui.btnPlayPause) {
      this.ui.btnPlayPause.innerHTML = isPlaying ? '⏸' : '▶';
      this.ui.btnPlayPause.title = isPlaying ? 'Pausar Trilha' : 'Reproduzir Trilha';
      this.ui.btnPlayPause.classList.toggle('is-playing', isPlaying);
    }

    // Ondas Sonoras
    if (this.ui.soundwave) {
      this.ui.soundwave.classList.toggle('active', isPlaying);
    }

    // Título e Artista
    if (this.currentTrack) {
      const isAmbient = this.currentTrack.role === 'ambient';
      if (this.ui.trackTitle) {
        this.ui.trackTitle.textContent = isAmbient
          ? `📻 ${this.currentTrack.title}`
          : `♪ ${this.currentTrack.title}`;
        this.ui.trackTitle.title = isAmbient
          ? `Rádio Ambiente Spotify: ${this.currentTrack.title}`
          : `Trilha de Cena: ${this.currentTrack.title}`;
      }
      if (this.ui.trackArtist) {
        this.ui.trackArtist.textContent = isAmbient
          ? `${this.currentTrack.artist} (Rádio Ambiente)`
          : this.currentTrack.artist || 'Skyhaven OST';
      }
      if (this.ui.hudActiveTrack) {
        this.ui.hudActiveTrack.style.display = 'flex';
      }
    } else {
      if (this.ui.trackTitle) this.ui.trackTitle.textContent = 'Aguardando trilha...';
      if (this.ui.trackArtist) this.ui.trackArtist.textContent = 'Inicie a leitura para ativar o áudio';
    }
  }

  _onPlayerStateChanged(isPlaying) {
    if (isPlaying) {
      this.consecutiveErrorCount = 0;
    }
    this._updateUI(isPlaying);
  }
}

// Exporta globalmente
window.PlayerManager = PlayerManager;
