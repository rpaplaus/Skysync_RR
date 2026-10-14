/**
 * Skysync - PlayerManager (Fase 9: Máquina de Estados Non-Stop e Ajuste Global de 4s)
 * Controla os adaptadores (YouTube Dual-Deck / Spotify), gerencia a fila contínua,
 * o sorteio de faixas ambientais (sem repetição consecutiva), a transição no evento ENDED
 * e a interrupção imediata com crossfade padronizado de 4000ms quando um Lookahead Trigger de cena é acionado.
 */

class PlayerManager {
  constructor() {
    this.STORAGE_KEYS = {
      LAST_TRACK_ID: 'skysync_last_track_id',
      PLAYER_MODE: 'skysync_player_mode',
      VOLUME: 'skysync_volume',
      MANUAL_PAUSE: 'skysync_manual_pause',
    };

    // Provedores suportados
    this.adapters = {
      youtube: new window.YouTubeAdapter(),
      spotify: new window.SpotifyAdapter(),
    };

    // Provedor ativo
    this.activeProviderName = localStorage.getItem(this.STORAGE_KEYS.PLAYER_MODE) || 'youtube';
    this.currentTrack = null;
    this.isManuallyPaused = localStorage.getItem(this.STORAGE_KEYS.MANUAL_PAUSE) === 'true';
    this.volume = parseFloat(localStorage.getItem(this.STORAGE_KEYS.VOLUME)) || 0.85;

    // Catálogo e Fila da Rádio Ambiente (Non-Stop)
    this.fullCatalog = {};
    this.ambientTracks = [];
    this.lastAmbientTrackId = null;

    // Gerenciador de timer de gatilho
    this.pendingTriggerTimer = null;
    this.pendingTriggerBlockId = null;
    this.pendingTriggerTrack = null;

    // Elementos da UI
    this.ui = {
      btnPlayPause: null,
      trackTitle: null,
      trackArtist: null,
      soundwave: null,
      volumeSlider: null,
      providerSelect: null,
      hudActiveTrack: null,
    };
  }

  /**
   * Inicializa o catálogo, adaptadores, escuta de eventos ENDED e UI.
   */
  async init() {
    console.log('[Skysync PlayerManager] Inicializando Dual Player & Máquina de Estados Non-Stop (Padrão 4s)...');
    this._bindUIElements();

    // 1. Carrega catálogo de trilhas para catalogar faixas da Rádio Ambiente
    await this._loadCatalog();

    // 2. Inicializa os dois adaptadores
    await Promise.all([
      this.adapters.youtube.init('youtube-player-deck-a'),
      this.adapters.spotify.init('spotify-player-frame'),
    ]);

    // 3. Configura callbacks de estado de reprodução e fim natural de faixa (ENDED)
    this.adapters.youtube.setOnStateChange((isPlaying) => this._onPlayerStateChanged(isPlaying));
    this.adapters.youtube.setOnTrackEnd((endedTrack) => this.handleTrackEnded(endedTrack));

    this.adapters.spotify.setOnStateChange((isPlaying) => this._onPlayerStateChanged(isPlaying));
    this.adapters.spotify.setOnTrackEnd((endedTrack) => this.handleTrackEnded(endedTrack));

    // 4. Ajusta volume inicial
    this.setVolume(this.volume);

    // 5. Escuta evento disparado pelo leitor para Lookahead Trigger
    window.addEventListener('skysync:paragraph-change', (event) => {
      this.handleParagraphChange(event.detail);
    });

    this._updateUI();
    console.log(
      `[Skysync PlayerManager] Pronto. Provedor ativo: ${this.activeProviderName.toUpperCase()} ` +
      `| Faixas ambiente cadastradas: ${this.ambientTracks.length}`
    );
  }

  get activeAdapter() {
    return this.adapters[this.activeProviderName] || this.adapters.youtube;
  }

  /**
   * Carrega o catálogo da API e separa as faixas com role === 'ambient'.
   */
  async _loadCatalog() {
    try {
      const res = await fetch('/api/v1/tracks/catalog');
      if (res.ok) {
        const catalog = await res.json();
        this.fullCatalog = catalog;

        // Filtra faixas com role: "ambient"
        const ambients = Object.values(catalog).filter(
          (t) => t.role === 'ambient'
        );

        if (ambients.length > 0) {
          this.ambientTracks = ambients;
        } else {
          // Fallback seguro caso nenhuma esteja marcada
          this.ambientTracks = Object.values(catalog).slice(0, 4);
        }

        console.log(`📻 [Skysync Catálogo] ${this.ambientTracks.length} faixas ambient catalogadas para a rádio contínua.`);
      }
    } catch (e) {
      console.warn('[Skysync PlayerManager] Falha ao carregar catálogo de faixas:', e);
      this.ambientTracks = [];
    }
  }

  /**
   * Sorteia uma música aleatória da lista ambient sem repetir a anterior consecutivamente.
   */
  getRandomAmbientTrack() {
    if (!this.ambientTracks || this.ambientTracks.length === 0) {
      return null;
    }

    let candidates = this.ambientTracks;
    // Não repete a mesma música ambient duas vezes seguidas
    if (candidates.length > 1 && this.lastAmbientTrackId) {
      candidates = candidates.filter((t) => t.id !== this.lastAmbientTrackId);
    }

    const randomIndex = Math.floor(Math.random() * candidates.length);
    const selected = candidates[randomIndex];
    this.lastAmbientTrackId = selected.id;
    return selected;
  }

  /**
   * Inicia ou faz crossfade para uma nova faixa da Rádio Ambiente (Padrão 4000ms).
   */
  playRandomAmbientTrack(fadeDurationMs = 4000) {
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
      `📻 [Skysync Rádio Ambiente] Sorteada e tocando: '${ambientTrack.title}' (Crossfade: ${fadeDurationMs}ms)`
    );

    this.currentTrack = ambientTrack;
    localStorage.setItem(this.STORAGE_KEYS.LAST_TRACK_ID, ambientTrack.id);

    this.activeAdapter.loadTrack(ambientTrack, true, fadeDurationMs);
    this._updateUI(true);
  }

  /**
   * Início da Leitura: Ao clicar em 'Iniciar/Continuar Leitura', o sistema sorteia e toca
   * uma música da lista ambient com transição padrão de 4000ms.
   */
  async playAmbientTrack() {
    this.isManuallyPaused = false;
    localStorage.setItem(this.STORAGE_KEYS.MANUAL_PAUSE, 'false');

    if (!this.ambientTracks || this.ambientTracks.length === 0) {
      await this._loadCatalog();
    }

    this.playRandomAmbientTrack(4000);
  }

  /**
   * Fim de Faixa (ENDED):
   * Escuta o evento emitido pelo adaptador do YouTube.
   * Se a música que acabou era trigger -> crossfade para nova música aleatória ambient (4000ms).
   * Se a música que acabou era ambient -> crossfade para outra música aleatória ambient (4000ms).
   */
  handleTrackEnded(endedTrack) {
    const trackTitle = endedTrack?.title || this.currentTrack?.title || 'Faixa';
    const trackRole = endedTrack?.role || this.currentTrack?.role || 'trigger';

    console.log(
      `⏹️ [Skysync Máquina de Estados] Fim da música detectado: '${trackTitle}' (role: ${trackRole}). ` +
      `Ativando transição non-stop para a próxima faixa da Rádio Ambiente (4000ms)...`
    );

    if (this.isManuallyPaused) {
      console.log('[Skysync Player] Transição automática ignorada: usuário pausou manualmente.');
      return;
    }

    // Tanto trigger quanto ambient transitam continuamente para nova música ambient aleatória
    this.playRandomAmbientTrack(4000);
  }

  /**
   * Interrupção por Gatilho (Lookahead):
   * Se uma música ambient estiver tocando e o usuário avançar para uma página que possui
   * um Lookahead Trigger (música trigger), o sistema faz o crossfade imediatamente da ambient para a trigger.
   */
  handleParagraphChange(detail) {
    const { paragraphId, audioTrigger } = detail;

    // Cancela qualquer timer de gatilho anterior
    if (this.pendingTriggerTimer) {
      clearTimeout(this.pendingTriggerTimer);
      this.pendingTriggerTimer = null;
    }
    this.pendingTriggerBlockId = null;
    this.pendingTriggerTrack = null;

    if (!audioTrigger || !audioTrigger.track) {
      return;
    }

    const newTrack = audioTrigger.track;
    newTrack.role = newTrack.role || 'trigger';

    // Se a música já for a mesma atualmente em reprodução, mantém
    if (this.currentTrack && this.currentTrack.id === newTrack.id) {
      return;
    }

    // Se a música atual for 'ambient', a transição para a música trigger é imediata (delay reduzido)
    const isCurrentlyAmbient = this.currentTrack && this.currentTrack.role === 'ambient';
    const delayMs = isCurrentlyAmbient ? Math.min(300, audioTrigger.delay_ms || 300) : (audioTrigger.delay_ms || 1000);

    this.pendingTriggerBlockId = paragraphId;
    this.pendingTriggerTrack = newTrack;

    console.log(
      `[Skysync Player] Gatilho de cena detectado (${newTrack.title}). ` +
      `${isCurrentlyAmbient ? 'Interrompendo Rádio Ambiente com crossfade imediato (4s)...' : `Aguardando delay de ${delayMs}ms...`}`
    );

    this.pendingTriggerTimer = setTimeout(() => {
      this._executeTrigger(audioTrigger, paragraphId);
    }, delayMs);
  }

  /**
   * Executa o crossfade definitivo para a faixa de cena disparada (4000ms padrão global).
   */
  _executeTrigger(audioTrigger, paragraphId) {
    const track = audioTrigger.track;
    track.role = track.role || 'trigger';

    this.pendingTriggerTimer = null;
    this.pendingTriggerBlockId = null;
    this.pendingTriggerTrack = null;

    console.log(`🔀 [Skysync Player] Disparando trilha de cena: '${track.title}' (${track.artist}) [Crossfade: 4000ms]`);

    this.currentTrack = track;
    localStorage.setItem(this.STORAGE_KEYS.LAST_TRACK_ID, track.id);

    if (this.isManuallyPaused) {
      console.log('[Skysync Player] Reprodução automática bloqueada: usuário pausou manualmente.');
      this.activeAdapter.loadTrack(track, false);
      this._updateUI(false);
      return;
    }

    const fadeDuration = audioTrigger.playback_options?.fade_in_ms || 4000;
    this.activeAdapter.loadTrack(track, true, fadeDuration);
    this._updateUI(true);
  }

  /**
   * Botão Global de Play/Pause na interface.
   */
  togglePlayPause() {
    const isPlaying = this.activeAdapter.isPlaying();

    if (isPlaying) {
      this.activeAdapter.pause();
      this.isManuallyPaused = true;
      localStorage.setItem(this.STORAGE_KEYS.MANUAL_PAUSE, 'true');
      console.log('[Skysync Player] Usuário pausou manualmente a trilha.');
      this._updateUI(false);
    } else {
      this.isManuallyPaused = false;
      localStorage.setItem(this.STORAGE_KEYS.MANUAL_PAUSE, 'false');
      console.log('[Skysync Player] Usuário retomou a trilha.');

      if (this.currentTrack) {
        this.activeAdapter.play();
        this._updateUI(true);
      } else {
        // Se ainda não tocou nenhuma, inicia a rádio ambiente com 4000ms
        this.playRandomAmbientTrack(4000);
      }
    }
  }

  /**
   * Altera o volume do reprodutor.
   */
  setVolume(volFloat) {
    this.volume = Math.max(0, Math.min(1, volFloat));
    localStorage.setItem(this.STORAGE_KEYS.VOLUME, this.volume.toString());
    this.activeAdapter.setVolume(this.volume);
    if (this.ui.volumeSlider) {
      this.ui.volumeSlider.value = Math.round(this.volume * 100);
    }
  }

  /**
   * Troca dinâmica entre YouTube e Spotify.
   */
  setProvider(providerName) {
    if (!this.adapters[providerName] || providerName === this.activeProviderName) return;

    console.log(`[Skysync Player] Alternando provedor: ${this.activeProviderName} -> ${providerName}`);

    const wasPlaying = this.activeAdapter.isPlaying();
    this.activeAdapter.pause();

    this.activeProviderName = providerName;
    localStorage.setItem(this.STORAGE_KEYS.PLAYER_MODE, providerName);

    if (this.currentTrack) {
      this.activeAdapter.loadTrack(this.currentTrack, wasPlaying && !this.isManuallyPaused);
    }

    this._updateUI(this.activeAdapter.isPlaying());
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
    this.ui.providerSelect = document.getElementById('player-provider-select');
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

    if (this.ui.providerSelect) {
      this.ui.providerSelect.value = this.activeProviderName;
      this.ui.providerSelect.addEventListener('change', (e) => {
        this.setProvider(e.target.value);
      });
    }
  }

  /**
   * Atualiza a UI refletindo o estado de reprodução e se a música é ambiente ou gatilho de cena.
   */
  _updateUI(isPlayingOverride) {
    const isPlaying =
      typeof isPlayingOverride === 'boolean'
        ? isPlayingOverride
        : this.activeAdapter.isPlaying();

    // Botão Play/Pause
    if (this.ui.btnPlayPause) {
      this.ui.btnPlayPause.innerHTML = isPlaying ? '⏸' : '▶';
      this.ui.btnPlayPause.title = isPlaying ? 'Pausar Trilha' : 'Reproduzir Trilha';
      this.ui.btnPlayPause.classList.toggle('is-playing', isPlaying);
    }

    // Ondas Sonoras (Soundwave)
    if (this.ui.soundwave) {
      this.ui.soundwave.classList.toggle('active', isPlaying);
    }

    // Nome e Artista da Música (com distinção de Rádio Ambiente vs Cena)
    if (this.currentTrack) {
      const isAmbient = this.currentTrack.role === 'ambient';
      if (this.ui.trackTitle) {
        this.ui.trackTitle.textContent = isAmbient
          ? `📻 ${this.currentTrack.title}`
          : `♪ ${this.currentTrack.title}`;
        this.ui.trackTitle.title = isAmbient
          ? `Rádio Ambiente Contínua: ${this.currentTrack.title}`
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
      if (this.ui.trackArtist) this.ui.trackArtist.textContent = 'Inicie a leitura para ativar a rádio';
    }
  }

  _onPlayerStateChanged(isPlaying) {
    this._updateUI(isPlaying);
  }
}

// Exporta globalmente
window.PlayerManager = PlayerManager;
