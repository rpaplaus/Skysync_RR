/**
 * Skysync - Main Orchestrator (Fase 13: 100% Exclusivo Spotify)
 * Gerencia a tela inicial com autenticação obrigatória via Spotify Premium,
 * captura e persistência do token OAuth recebido via callback (?token=XYZ),
 * liberação do botão '▶ Iniciar/Continuar Leitura' e acionamento coordenado do Spotify SDK.
 */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    TOKEN: 'skysync_spotify_token',
    LEGACY_TOKEN: 'spotify_access_token',
    LAST_CHAPTER: 'skysync_last_chapter_id',
    LAST_PARAGRAPH: 'skysync_last_paragraph_id',
    LAST_TRACK_ID: 'skysync_last_track_id',
  };

  // Referências do DOM da Splash Screen
  const splashEl = document.getElementById('splash-screen');
  const btnSpotifyLogin = document.getElementById('btn-spotify-login');
  const btnEnterReading = document.getElementById('btn-enter-reading');
  const btnEnterReadingText = document.getElementById('btn-enter-reading-text');
  const btnResetReading = document.getElementById('btn-reset-reading');
  const btnResetReadingText = document.getElementById('btn-reset-reading-text');
  const modalResetConfirm = document.getElementById('modal-reset-confirm');
  const btnModalCancel = document.getElementById('btn-modal-cancel');
  const btnModalConfirm = document.getElementById('btn-modal-confirm');
  const brandLogo = document.getElementById('brand-logo');
  const splashAuthNotice = document.getElementById('splash-auth-notice');

  let playerManager = null;
  let bookData = null;

  async function startApplication() {
    console.log('🌌 [Skysync] Inicializando sistema Skyhaven (Fase 13: 100% Exclusivo Spotify)...');

    // 1. Processa parâmetros de autenticação na URL (Callback do Spotify)
    handleUrlAuthParameters();

    // 2. Aguarda ou recupera os dados do livro
    if (window.SkysyncReader && window.SkysyncReader.getBook()) {
      bookData = window.SkysyncReader.getBook();
      updateSplashState();
    } else {
      window.addEventListener('skysync:book-ready', (e) => {
        bookData = e.detail?.book;
        updateSplashState();
      });
    }

    // 3. Inicializa o PlayerManager (Spotify Web Playback SDK)
    if (window.PlayerManager) {
      try {
        playerManager = new window.PlayerManager();
        await playerManager.init();
        window.skysyncPlayer = playerManager;
        console.log('🎧 [Skysync] PlayerManager pronto com Spotify Web Playback SDK.');
      } catch (e) {
        console.error('[Skysync] Falha ao inicializar PlayerManager:', e);
      }
    }

    // 4. Configura eventos dos botões da Splash Screen
    setupSplashButtons();
  }

  /**
   * Processa parâmetros de URL vindos do OAuth (/api/v1/auth/callback):
   * Se ?token=XYZ estiver presente: salva no localStorage e limpa a URL.
   */
  function handleUrlAuthParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const authError = urlParams.get('auth_error');

    if (token) {
      console.log('🔑 [Skysync Auth] Token de acesso do Spotify recebido via callback. Salvando no LocalStorage...');
      localStorage.setItem(STORAGE_KEYS.TOKEN, token);
      localStorage.setItem(STORAGE_KEYS.LEGACY_TOKEN, token);

      // Limpa os parâmetros sensíveis da barra de endereços sem recarregar
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);

      if (splashAuthNotice) {
        splashAuthNotice.className = 'splash-auth-notice success';
        splashAuthNotice.textContent = '✓ Conectado ao Spotify Premium com sucesso!';
        splashAuthNotice.style.display = 'block';
      }
    } else if (authError) {
      console.warn('⚠️ [Skysync Auth] Erro retornado na autenticação do Spotify:', authError);
      if (splashAuthNotice) {
        splashAuthNotice.className = 'splash-auth-notice error';
        splashAuthNotice.textContent = `Aviso: Falha na conexão com Spotify (${authError}). Tente novamente.`;
        splashAuthNotice.style.display = 'block';
      }
    }

    updateSplashState();
  }

  /**
   * Obtém o token de acesso salvo.
   */
  function getSavedToken() {
    return (
      localStorage.getItem(STORAGE_KEYS.TOKEN) ||
      localStorage.getItem(STORAGE_KEYS.LEGACY_TOKEN) ||
      ''
    );
  }

  /**
   * Atualiza o estado da Splash Screen:
   * - Se NÃO houver token: Mostra apenas '🎧 Conectar com Spotify Premium'.
   * - Se HOUVER token:
   *   - Se houver progresso: Exibe '▶ Retomar Leitura' E '↺ Reiniciar Leitura'.
   *   - Se não houver progresso: Exibe '▶ Iniciar Leitura'.
   */
  function updateSplashState() {
    const token = getSavedToken();
    const hasToken = Boolean(token);
    const lastChapterId = localStorage.getItem(STORAGE_KEYS.LAST_CHAPTER);

    if (hasToken) {
      // Usuário autenticado: oculta o botão de login e exibe o de entrada na leitura
      if (btnSpotifyLogin) btnSpotifyLogin.style.display = 'none';
      if (btnEnterReading) btnEnterReading.style.display = 'inline-flex';

      // Define rótulo inteligente (Retomar Leitura se houver progresso prévio)
      let label = '▶ Iniciar Leitura';
      if (lastChapterId) {
        if (lastChapterId === 'cap-preface' || lastChapterId.toLowerCase().includes('preface')) {
          label = '▶ Retomar Leitura (Prefácio)';
        } else if (bookData && bookData.chapters) {
          const ch = bookData.chapters.find((c) => c.id === lastChapterId);
          if (ch) {
            label = ch.is_preface || ch.number === 0
              ? '▶ Retomar Leitura (Prefácio)'
              : `▶ Retomar Leitura (Capítulo ${ch.number})`;
          }
        } else {
          const match = lastChapterId.match(/cap-0*(\d+)/i);
          if (match && match[1] !== '0') {
            label = `▶ Retomar Leitura (Capítulo ${match[1]})`;
          }
        }
      }

      if (btnEnterReadingText) {
        btnEnterReadingText.textContent = label;
      }

      // Botão Reiniciar Leitura (Reset): visível quando há progresso salvo prévio
      if (btnResetReading) {
        btnResetReading.style.display = lastChapterId ? 'inline-flex' : 'none';
      }

      console.log('🎧 [Skysync Splash] Usuário autenticado. Botões atualizados:', {
        label,
        hasProgress: Boolean(lastChapterId),
      });
    } else {
      // Usuário não autenticado: exige conexão com Spotify Premium
      if (btnSpotifyLogin) btnSpotifyLogin.style.display = 'inline-flex';
      if (btnEnterReading) btnEnterReading.style.display = 'none';
      if (btnResetReading) btnResetReading.style.display = 'none';
    }
  }

  /**
   * Configura os eventos de clique dos botões da Splash Screen, Modal de Reset e Player Bar.
   */
  function setupSplashButtons() {
    if (btnEnterReading) {
      btnEnterReading.addEventListener('click', () => {
        // Chamada síncrona de unlockAudio() antes de qualquer await
        if (playerManager?.adapter && typeof playerManager.adapter.unlockAudio === 'function') {
          playerManager.adapter.unlockAudio();
        }
        const lastChapterId = localStorage.getItem(STORAGE_KEYS.LAST_CHAPTER);
        handleEnterReader({ isResume: Boolean(lastChapterId) });
      });
    }

    if (btnResetReading) {
      btnResetReading.addEventListener('click', () => {
        showResetConfirmationModal();
      });
    }

    if (btnModalCancel) {
      btnModalCancel.addEventListener('click', hideResetConfirmationModal);
    }

    if (btnModalConfirm) {
      btnModalConfirm.addEventListener('click', () => {
        hideResetConfirmationModal();
        confirmResetAndStart();
      });
    }

    if (modalResetConfirm) {
      modalResetConfirm.addEventListener('click', (e) => {
        if (e.target === modalResetConfirm) {
          hideResetConfirmationModal();
        }
      });
    }

    // Tecla ESC fecha o modal de reset
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalResetConfirm && modalResetConfirm.style.display !== 'none') {
        hideResetConfirmationModal();
      }
    });

    // Clique no logotipo Skysync no topo: permite retornar suavemente à tela de início
    if (brandLogo) {
      brandLogo.addEventListener('click', (e) => {
        e.preventDefault();
        updateSplashState();
        if (splashEl) {
          splashEl.classList.remove('hidden');
        }
        document.body.classList.add('has-splash');
      });
    }

    // No clique do botão Play/Pause da barra do player, chame sincronamente unlockAudio()
    const btnPlayerPlay = document.getElementById('btn-player-play');
    if (btnPlayerPlay) {
      btnPlayerPlay.addEventListener('click', () => {
        if (playerManager?.adapter && typeof playerManager.adapter.unlockAudio === 'function') {
          playerManager.adapter.unlockAudio();
        }
      });
    }
  }

  /**
   * Exibe o modal de confirmação para reiniciar a leitura.
   */
  function showResetConfirmationModal() {
    if (modalResetConfirm) {
      modalResetConfirm.style.display = 'flex';
    } else {
      if (window.confirm('Deseja realmente reiniciar a leitura do início? O seu progresso atual salvo será redefinido.')) {
        confirmResetAndStart();
      }
    }
  }

  /**
   * Oculta o modal de confirmação de reset.
   */
  function hideResetConfirmationModal() {
    if (modalResetConfirm) {
      modalResetConfirm.style.display = 'none';
    }
  }

  /**
   * Executa a reinicialização da leitura a partir do início do livro.
   */
  function confirmResetAndStart() {
    console.log('↺ [Skysync Reset] Reiniciando progresso de leitura a partir do início...');
    if (playerManager?.adapter && typeof playerManager.adapter.unlockAudio === 'function') {
      playerManager.adapter.unlockAudio();
    }
    localStorage.removeItem(STORAGE_KEYS.LAST_PARAGRAPH);
    localStorage.removeItem(STORAGE_KEYS.LAST_CHAPTER);
    localStorage.removeItem(STORAGE_KEYS.LAST_TRACK_ID);
    handleEnterReader({ isResume: false });
  }

  /**
   * Transição da Splash Screen para a Leitura (Correções 1, 3 e 4).
   */
  async function handleEnterReader({ isResume }) {
    console.log(`🚀 [Skysync] Entrando no modo de leitura (isResume=${isResume})...`);

    // 1. Oculta a Splash Screen com animação suave
    if (splashEl) {
      splashEl.classList.add('hidden');
    }
    document.body.classList.remove('has-splash');

    // 2. Correção 3: Sempre força isManuallyPaused = false ao iniciar a leitura
    if (playerManager) {
      playerManager.isManuallyPaused = false;
      playerManager.pausedOnCurrentPage = false;
    }

    // 3. Correção 4 (Regra de Ouro): Ao clicar em "Iniciar Leitura", a primeira música a tocar
    // DEVE SER OBRIGATORIAMENTE a primeira música de gatilho: "Handle With Care" - Traveling Wilburys
    if (playerManager && typeof playerManager.playInitialTrack === 'function') {
      playerManager.playInitialTrack();
    }

    // 4. Conecta o player sob o contexto do gesto do usuário (AudioContext Unlock)
    if (playerManager && typeof playerManager.connect === 'function') {
      try {
        await playerManager.connect();
      } catch (e) {
        console.warn('[Skysync] Aviso ao conectar player:', e);
      }
    }

    // 5. Renderiza a página inicial (se houver gatilho na página, a guarda currentTrack.id === newTrack.id evita duplicidade)
    if (isResume) {
      if (window.SkysyncReader && window.SkysyncReader.restoreLastPosition) {
        window.SkysyncReader.restoreLastPosition();
      }
    } else {
      localStorage.removeItem(STORAGE_KEYS.LAST_PARAGRAPH);
      localStorage.removeItem(STORAGE_KEYS.LAST_CHAPTER);
      if (window.SkysyncReader && window.SkysyncReader.openChapterByIndex) {
        window.SkysyncReader.openChapterByIndex(0, 0);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApplication);
  } else {
    startApplication();
  }
})();
