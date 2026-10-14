/**
 * Skysync - Main Orchestrator (Fase 5: UX, Splash Screen & Orquestração de Áudio)
 * Gerencia a tela inicial, lógica de 'Continuar Leitura', disparo do áudio ambiente
 * e inicialização coordenada do Dual Player com Crossfade.
 */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    LAST_CHAPTER: 'skysync_last_chapter_id',
    LAST_PARAGRAPH: 'skysync_last_paragraph_id',
    LAST_TRACK_ID: 'skysync_last_track_id',
  };

  // Referências do DOM da Splash Screen
  const splashEl = document.getElementById('splash-screen');
  const btnStartReading = document.getElementById('btn-start-reading');
  const btnContinueReading = document.getElementById('btn-continue-reading');
  const btnContinueText = document.getElementById('btn-continue-reading-text');

  let playerManager = null;
  let bookData = null;

  async function startApplication() {
    console.log('🌌 [Skysync] Inicializando sistema Skyhaven (Fase 5)...');

    // 1. Inicializa o PlayerManager
    if (window.PlayerManager) {
      try {
        playerManager = new window.PlayerManager();
        await playerManager.init();
        window.skysyncPlayer = playerManager;
        console.log('🎵 [Skysync] PlayerManager pronto com Dual-Deck Crossfade.');
      } catch (e) {
        console.error('[Skysync] Falha ao inicializar PlayerManager:', e);
      }
    }

    // 2. Aguarda ou recupera os dados do livro
    if (window.SkysyncReader && window.SkysyncReader.getBook()) {
      bookData = window.SkysyncReader.getBook();
      setupSplashScreen();
    } else {
      window.addEventListener('skysync:book-ready', (e) => {
        bookData = e.detail?.book;
        setupSplashScreen();
      });
    }

    // Configura botões da Splash Screen
    setupSplashButtons();
  }

  /**
   * Configura o botão 'Continuar Leitura' caso exista progresso salvo no LocalStorage.
   */
  function setupSplashScreen() {
    const lastChapterId = localStorage.getItem(STORAGE_KEYS.LAST_CHAPTER);
    const lastParagraphId = localStorage.getItem(STORAGE_KEYS.LAST_PARAGRAPH);

    if (lastChapterId && btnContinueReading) {
      let label = 'Continuar Leitura';

      if (lastChapterId === 'cap-preface' || lastChapterId.toLowerCase().includes('preface')) {
        label = 'Continuar Leitura (Prefácio)';
      } else if (bookData && bookData.chapters) {
        const ch = bookData.chapters.find((c) => c.id === lastChapterId);
        if (ch) {
          if (ch.is_preface || ch.number === 0 || ch.id === 'cap-preface') {
            label = 'Continuar Leitura (Prefácio)';
          } else {
            label = `Continuar Leitura (Capítulo ${ch.number})`;
          }
        }
      } else {
        const match = lastChapterId.match(/cap-0*(\d+)/i);
        if (match && match[1] !== '0') {
          label = `Continuar Leitura (Capítulo ${match[1]})`;
        } else if (lastChapterId.includes('preface') || (match && match[1] === '0')) {
          label = 'Continuar Leitura (Prefácio)';
        }
      }

      if (btnContinueText) {
        btnContinueText.textContent = label;
      }
      btnContinueReading.style.display = 'inline-flex';
      console.log(`📌 [Skysync Splash] Progresso detectado no LocalStorage: ${label} (§${lastParagraphId})`);
    } else if (btnContinueReading) {
      btnContinueReading.style.display = 'none';
    }
  }

  /**
   * Configura os cliques dos botões da Splash Screen.
   */
  function setupSplashButtons() {
    if (btnStartReading) {
      btnStartReading.addEventListener('click', () => {
        handleEnterReader({ isResume: false });
      });
    }

    if (btnContinueReading) {
      btnContinueReading.addEventListener('click', () => {
        handleEnterReader({ isResume: true });
      });
    }
  }

  /**
   * Transição da Splash Screen para a Leitura e disparo da música de fundo ambiente.
   */
  async function handleEnterReader({ isResume }) {
    console.log(`🚀 [Skysync] Entrando no modo de leitura (isResume=${isResume})...`);

    // 1. Oculta a Splash Screen com animação suave
    if (splashEl) {
      splashEl.classList.add('hidden');
    }
    document.body.classList.remove('has-splash');

    // 2. Dispara a música de fundo ambiente/padrão imediatamente
    // O clique do usuário no botão destrava a política de Autoplay dos navegadores!
    if (playerManager) {
      playerManager.playAmbientTrack();
    }

    // 3. Posiciona o leitor
    if (isResume) {
      // Retoma exatamente onde o usuário parou
      if (window.SkysyncReader && window.SkysyncReader.restoreLastPosition) {
        setTimeout(() => {
          window.SkysyncReader.restoreLastPosition();
        }, 350);
      }
    } else {
      // Inicia do zero: limpa marcadores antigos e abre o início do livro
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
