/**
 * Skysync - Spotify Adapter (Iframe Embed Controller)
 * Integração simplificada para usuários com suporte ao Spotify Embed.
 */

class SpotifyAdapter {
  constructor() {
    this.name = 'spotify';
    this.containerId = 'spotify-player-frame';
    this.iframeElement = null;
    this.isReady = false;
    this.isPlayingTrack = false;
    this.currentTrackId = null;
    this.volume = 0.85;
    this.onStateChangeCallback = null;
  }

  /**
   * Inicializa o container do player Spotify.
   */
  init(containerId = 'spotify-player-frame') {
    this.containerId = containerId;
    return new Promise((resolve) => {
      let targetEl = document.getElementById(this.containerId);
      if (!targetEl) {
        targetEl = document.createElement('div');
        targetEl.id = this.containerId;
        targetEl.style.position = 'absolute';
        targetEl.style.width = '1px';
        targetEl.style.height = '1px';
        targetEl.style.opacity = '0.01';
        targetEl.style.pointerEvents = 'none';
        document.body.appendChild(targetEl);
      }

      // Criação do iframe embed
      let iframe = targetEl.querySelector('iframe');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'spotify-embed-iframe';
        iframe.width = '100%';
        iframe.height = '80';
        iframe.frameBorder = '0';
        iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
        iframe.loading = 'lazy';
        targetEl.appendChild(iframe);
      }
      this.iframeElement = iframe;
      this.isReady = true;
      console.log('[Skysync Spotify] Adapter inicializado.');
      resolve();
    });
  }

  /**
   * Carrega e aciona faixa no Spotify via Embed.
   */
  loadTrack(trackData, autoplay = true) {
    const spData = trackData?.providers?.spotify;
    if (!spData || !spData.id) {
      console.warn('[Skysync Spotify] Faixa sem id do Spotify:', trackData);
      return;
    }

    this.currentTrackId = spData.id;
    const embedUrl = `https://open.spotify.com/embed/track/${spData.id}?utm_source=generator&theme=0`;

    if (this.iframeElement) {
      this.iframeElement.src = embedUrl;
      this.isPlayingTrack = autoplay;
      console.log(`[Skysync Spotify] Carregada faixa: ${spData.id}`);

      if (typeof this.onStateChangeCallback === 'function') {
        this.onStateChangeCallback(this.isPlayingTrack);
      }
    }
  }

  play() {
    this.isPlayingTrack = true;
    if (typeof this.onStateChangeCallback === 'function') {
      this.onStateChangeCallback(true);
    }
  }

  pause() {
    this.isPlayingTrack = false;
    // Oculta/pausa o embed limpando ou silenciando se necessário
    if (typeof this.onStateChangeCallback === 'function') {
      this.onStateChangeCallback(false);
    }
  }

  setVolume(volumeFloat) {
    this.volume = volumeFloat;
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

// Exporta globalmente para o ambiente do navegador
window.SpotifyAdapter = SpotifyAdapter;
