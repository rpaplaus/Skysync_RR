/**
 * Skysync - Reader Engine (Fase 7: Paginação Estilo Kindle e Lookahead Trigger)
 * Elimina o scroll contínuo e o IntersectionObserver, implementando uma experiência
 * paginada com cálculo dinâmico de blocos no viewport, áreas de clique laterais,
 * indicador discreto 'Página X de Y' e disparo antecipado de áudio por lookahead (N+1).
 */

(function () {
  'use strict';

  // --- CONFIGURAÇÃO E CHAVES DE STORAGE (skysync_...) ---
  const STORAGE_KEYS = {
    THEME: 'skysync_theme',
    FONT_SIZE: 'skysync_font_size',
    LAST_CHAPTER: 'skysync_last_chapter_id',
    LAST_PARAGRAPH: 'skysync_last_paragraph_id',
    LAST_TRACK_ID: 'skysync_last_track_id',
  };

  // --- ESTADO DA APLICAÇÃO ---
  const state = {
    book: null,
    currentChapterIndex: 0,
    currentPageIndex: 0,
    pages: [], // Array de arrays de ContentBlock: pages[pageIdx] = [block1, block2, ...]
    currentTheme: localStorage.getItem(STORAGE_KEYS.THEME) || 'dark',
    fontSizeRem: parseFloat(localStorage.getItem(STORAGE_KEYS.FONT_SIZE)) || 1.25,
    isLoaded: false,
  };

  // --- ELEMENTOS DO DOM ---
  const elements = {
    readerContainer: document.getElementById('reader-container'),
    readerContent: document.getElementById('reader-content'),
    progressBar: document.getElementById('reading-progress-fill'),
    headerChapterTitle: document.getElementById('header-chapter-title'),
    hudReadingInfo: document.getElementById('hud-reading-info'),
    zonePrev: document.getElementById('page-zone-prev'),
    zoneNext: document.getElementById('page-zone-next'),
    drawerOverlay: document.getElementById('drawer-overlay'),
    drawerPanel: document.getElementById('drawer-panel'),
    chapterList: document.getElementById('chapter-list'),
    prefaceTocCard: document.getElementById('preface-toc-card'),
    btnToggleDrawer: document.getElementById('btn-toggle-drawer'),
    btnCloseDrawer: document.getElementById('btn-close-drawer'),
    drawerTabBtnPreface: document.getElementById('drawer-tab-btn-preface'),
    drawerTabBtnChapters: document.getElementById('drawer-tab-btn-chapters'),
    drawerTabPreface: document.getElementById('drawer-tab-preface'),
    drawerTabChapters: document.getElementById('drawer-tab-chapters'),
    btnFontDecrease: document.getElementById('btn-font-decrease'),
    btnFontIncrease: document.getElementById('btn-font-increase'),
    themeButtons: document.querySelectorAll('.theme-btn'),
  };

  let measuringStageEl = null;

  // --- INICIALIZAÇÃO ---
  async function init() {
    applyTheme(state.currentTheme, false);
    applyFontSize(state.fontSizeRem, false);
    setupEventListeners();
    await loadBookData();
  }

  // --- CONSUMO DA API FASTAPI ---
  async function loadBookData() {
    try {
      showLoading();
      const response = await fetch('/api/v1/book');
      if (!response.ok) {
        throw new Error(`Falha ao carregar o livro (HTTP ${response.status})`);
      }
      state.book = await response.json();

      // Renderiza Sumário no Drawer com Abas (Prefácio vs Capítulos)
      renderTableOfContents(state.book.chapters);

      // Determina posição inicial (restaura progresso salvo ou inicia do começo)
      const lastChapterId = localStorage.getItem(STORAGE_KEYS.LAST_CHAPTER);
      const lastParagraphId = localStorage.getItem(STORAGE_KEYS.LAST_PARAGRAPH);

      if (lastChapterId) {
        const foundIdx = state.book.chapters.findIndex((c) => c.id === lastChapterId);
        state.currentChapterIndex = foundIdx !== -1 ? foundIdx : 0;
      } else {
        state.currentChapterIndex = 0;
      }

      // Calcula as páginas do capítulo inicial
      const chapter = state.book.chapters[state.currentChapterIndex];
      state.pages = paginateChapter(chapter);

      if (lastParagraphId) {
        const pIdx = state.pages.findIndex((page) =>
          page.some((b) => b.id === lastParagraphId)
        );
        state.currentPageIndex = pIdx !== -1 ? pIdx : 0;
      } else {
        state.currentPageIndex = 0;
      }

      state.isLoaded = true;

      // Renderiza a página ativa
      renderCurrentPage();

      // Dispara evento informando que os dados do livro estão prontos para a Splash Screen
      window.dispatchEvent(
        new CustomEvent('skysync:book-ready', {
          detail: { book: state.book },
        })
      );
    } catch (err) {
      console.error('[Skysync] Erro ao carregar livro:', err);
      showError(err.message);
    }
  }

  // --- ESTÁGIO INVISÍVEL DE MEDIÇÃO DE ALTURA ---
  function getMeasuringStage(widthPx) {
    if (!measuringStageEl) {
      measuringStageEl = document.createElement('div');
      measuringStageEl.className = 'reader-measuring-stage';
      measuringStageEl.id = 'reader-measuring-stage';
      document.body.appendChild(measuringStageEl);
    }
    measuringStageEl.style.width = `${widthPx}px`;
    measuringStageEl.style.fontSize = `${state.fontSizeRem}rem`;
    return measuringStageEl;
  }

  // --- MOTOR DE PAGINAÇÃO DINÂMICA (ESTILO KINDLE) ---
  /**
   * Divide os blocos de um capítulo em páginas virtuais com base na altura útil do leitor.
   * Executa a medição em lote no DOM em um estágio invisível para evitar layout thrashing.
   */
  function paginateChapter(chapter) {
    if (!chapter || !chapter.content_blocks || chapter.content_blocks.length === 0) {
      return [[]];
    }

    // Calcula dimensões do viewport do leitor
    const container = elements.readerContainer;
    const containerHeight = container && container.clientHeight > 100
      ? container.clientHeight
      : (window.innerHeight - 124);
    const containerWidth = container && container.clientWidth > 100
      ? container.clientWidth
      : window.innerWidth;

    // Largura útil da coluna de leitura (limitada a 740px)
    const readingWidth = Math.min(Math.max(280, containerWidth - 64), 740);

    // Altura útil para o texto (viewport menos padding do contêiner e o rodapé 'Página X de Y')
    // padding vertical (~40px) + rodapé (~38px) = ~78px
    const availableHeight = Math.max(260, containerHeight - 85);

    // Configura o estágio de medição invisível
    const stage = getMeasuringStage(readingWidth);
    stage.style.width = `${readingWidth}px`;
    stage.innerHTML = '';

    const isPreface = chapter.is_preface || chapter.id === 'cap-preface';

    // 1. Mede o cabeçalho do capítulo (renderizado somente na Página 1)
    const headerHtml = isPreface
      ? `<header class="preface-header">
           <div class="preface-label">✦ Manuscrito Original ✦</div>
           <h2 class="preface-title">${escapeHtml(chapter.title)}</h2>
         </header>`
      : `<header class="chapter-header">
           <div class="chapter-number-label">Capítulo ${chapter.number}</div>
           <h2 class="chapter-title-heading">${escapeHtml(chapter.title)}</h2>
           <div class="chapter-read-time">Tempo estimado: ~${chapter.estimated_read_time_minutes} min</div>
         </header>`;

    const headerDiv = document.createElement('div');
    headerDiv.innerHTML = headerHtml;
    stage.appendChild(headerDiv);
    const headerHeight = headerDiv.offsetHeight + 18;
    stage.removeChild(headerDiv);

    // 2. Insere todos os blocos no estágio de uma só vez para medição em batch
    const fragment = document.createDocumentFragment();
    const blockDivs = [];

    chapter.content_blocks.forEach((block) => {
      let badgeHtml = '';
      if (block.audio_trigger && block.audio_trigger.track) {
        const track = block.audio_trigger.track;
        badgeHtml = `
          <div class="music-trigger-badge">
            <span class="music-badge-pulse"></span>
            <span>♪ Trilha: ${escapeHtml(track.title)} — ${escapeHtml(track.artist)}</span>
          </div>
        `;
      }

      const div = document.createElement('div');
      div.className = 'reading-block';
      div.innerHTML = `${badgeHtml}<p class="reading-paragraph-text">${escapeHtml(block.text)}</p>`;
      fragment.appendChild(div);
      blockDivs.push(div);
    });
    stage.appendChild(fragment);

    // 3. Lê as alturas de todos os blocos em um único passe (batch read)
    const blockHeights = blockDivs.map((div) => div.offsetHeight + 18);

    // Limpa o estágio
    stage.innerHTML = '';

    // 4. Agrupa os blocos em páginas de acordo com a capacidade vertical da tela
    const pages = [];
    let currentPage = [];
    let currentHeight = 0;

    for (let i = 0; i < chapter.content_blocks.length; i++) {
      const block = chapter.content_blocks[i];
      const bHeight = blockHeights[i];
      const isFirstPage = pages.length === 0;
      const initialOffset = isFirstPage ? headerHeight : 0;

      // Se adicionar o bloco ultrapassar a altura máxima da página:
      if (currentPage.length > 0 && currentHeight + bHeight > availableHeight) {
        pages.push(currentPage);
        currentPage = [block];
        currentHeight = bHeight;
      } else {
        currentPage.push(block);
        currentHeight += (currentPage.length === 1 && isFirstPage) ? (initialOffset + bHeight) : bHeight;
      }
    }

    if (currentPage.length > 0) {
      pages.push(currentPage);
    }

    return pages.length > 0 ? pages : [[]];
  }

  // --- RENDERIZAÇÃO DA PÁGINA ATUAL ---
  function renderCurrentPage() {
    if (!state.book || !state.book.chapters || state.book.chapters.length === 0) return;

    const chapter = state.book.chapters[state.currentChapterIndex];
    if (!chapter) return;

    if (state.currentPageIndex < 0) state.currentPageIndex = 0;
    if (state.currentPageIndex >= state.pages.length) {
      state.currentPageIndex = Math.max(0, state.pages.length - 1);
    }

    const pageBlocks = state.pages[state.currentPageIndex] || [];
    const isFirstPage = state.currentPageIndex === 0;
    const isPreface = chapter.is_preface || chapter.id === 'cap-preface';
    const totalPages = state.pages.length;

    // 1. Cabeçalho (renderizado exclusivamente na primeira página do capítulo)
    let headerHtml = '';
    if (isFirstPage) {
      headerHtml = isPreface
        ? `<header class="preface-header">
             <div class="preface-label">✦ Manuscrito Original ✦</div>
             <h2 class="preface-title">${escapeHtml(chapter.title)}</h2>
           </header>`
        : `<header class="chapter-header">
             <div class="chapter-number-label">Capítulo ${chapter.number}</div>
             <h2 class="chapter-title-heading">${escapeHtml(chapter.title)}</h2>
             <div class="chapter-read-time">Tempo estimado: ~${chapter.estimated_read_time_minutes} min</div>
           </header>`;
    }

    // 2. Blocos de conteúdo da página atual
    let blocksHtml = '';
    pageBlocks.forEach((block) => {
      let badgeHtml = '';
      if (block.audio_trigger && block.audio_trigger.track) {
        const track = block.audio_trigger.track;
        badgeHtml = `
          <div 
            class="music-trigger-badge" 
            title="Clique para reproduzir esta trilha: ${escapeHtml(track.title)}" 
            data-track-id="${track.id}"
            data-block-id="${block.id}"
          >
            <span class="music-badge-pulse"></span>
            <span>♪ Trilha: ${escapeHtml(track.title)} — ${escapeHtml(track.artist)}</span>
          </div>
        `;
      }

      blocksHtml += `
        <div class="reading-block" id="${block.id}" data-chapter-id="${chapter.id}" data-order="${block.order}">
          ${badgeHtml}
          <p class="reading-paragraph-text">${escapeHtml(block.text)}</p>
        </div>
      `;
    });

    // 3. Monta o Viewport da página estilo Kindle
    const pageHtml = `
      <div class="reader-page-viewport" id="reader-page-viewport">
        <div class="reader-page-body">
          ${headerHtml}
          ${blocksHtml}
        </div>
        <footer class="reading-page-footer">
          <span class="reading-page-number">Página ${state.currentPageIndex + 1} de ${totalPages}</span>
        </footer>
      </div>
    `;

    elements.readerContent.innerHTML = pageHtml;

    // Disparo manual via clique nos badges musicais
    elements.readerContent.querySelectorAll('.music-trigger-badge').forEach((badge) => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const blockId = badge.getAttribute('data-block-id');
        const b = pageBlocks.find((item) => item.id === blockId);
        if (b && b.audio_trigger) {
          dispatchAudioTrigger(b, 0);
        }
      });
    });

    // 4. Atualiza os dados no HUD Superior e Inferior
    updateHUD(chapter, state.currentPageIndex + 1, totalPages);

    // 5. Atualiza o estado das setas de navegação laterais (prev/next)
    updateNavButtons();

    // 6. Atualiza a lista do Drawer para marcar o capítulo ativo
    updateDrawerActiveChapter(chapter.id);

    // 7. Persistência no LocalStorage (Requisito 2):
    // Salva o ID do primeiro bloco da página atual no LocalStorage
    if (pageBlocks.length > 0) {
      localStorage.setItem(STORAGE_KEYS.LAST_PARAGRAPH, pageBlocks[0].id);
    }
    localStorage.setItem(STORAGE_KEYS.LAST_CHAPTER, chapter.id);

    // 8. Gatilho de Áudio Antecipado (Lookahead Trigger - Requisito 2):
    checkLookaheadTrigger();
  }

  // --- ATUALIZAÇÃO DO HUD DE LEITURA ---
  function updateHUD(chapter, currentPageNum, totalPages) {
    const isPreface = chapter.is_preface || chapter.id === 'cap-preface';

    // Título do cabeçalho superior
    if (elements.headerChapterTitle) {
      elements.headerChapterTitle.textContent = isPreface
        ? chapter.title
        : `${chapter.number}. ${chapter.title}`;
    }

    // Indicador discreto no rodapé (Requisito 1): 'Página X de Y'
    if (elements.hudReadingInfo) {
      elements.hudReadingInfo.innerHTML = `
        <span class="hud-page-count">Página ${currentPageNum} de ${totalPages}</span>
        <span style="opacity: 0.4">•</span>
        <span class="hud-chapter-name">${isPreface ? 'Prefácio' : `Capítulo ${chapter.number}`}</span>
      `;
    }

    // Barra de progresso superior do capítulo
    if (elements.progressBar) {
      const percent = totalPages > 0 ? Math.round((currentPageNum / totalPages) * 100) : 0;
      elements.progressBar.style.width = `${percent}%`;
    }
  }

  // --- ATUALIZAÇÃO DOS BOTÕES LATERAIS DE NAVEGAÇÃO ---
  function updateNavButtons() {
    const isFirstChapter = state.currentChapterIndex === 0;
    const isLastChapter = state.currentChapterIndex === state.book.chapters.length - 1;
    const isFirstPage = state.currentPageIndex === 0;
    const isLastPage = state.currentPageIndex === state.pages.length - 1;

    const isAtAbsoluteBeginning = isFirstChapter && isFirstPage;
    const isAtAbsoluteEnd = isLastChapter && isLastPage;

    if (elements.zonePrev) {
      elements.zonePrev.classList.toggle('disabled', isAtAbsoluteBeginning);
      elements.zonePrev.setAttribute('aria-disabled', isAtAbsoluteBeginning ? 'true' : 'false');
    }
    if (elements.zoneNext) {
      elements.zoneNext.classList.toggle('disabled', isAtAbsoluteEnd);
      elements.zoneNext.setAttribute('aria-disabled', isAtAbsoluteEnd ? 'true' : 'false');
    }
  }

  // --- GATILHO DE ÁUDIO ANTECIPADO (LOOKAHEAD TRIGGER - REQUISITO 2) ---
  /**
   * Quando o usuário navega para a Página N, checa o array de blocos da Página N + 1.
   * Se houver um audioTrigger na página seguinte, dispara o evento de áudio imediatamente,
   * iniciando o crossfade no PlayerManager enquanto o usuário ainda lê a página atual.
   */
  function checkLookaheadTrigger() {
    const currentPageBlocks = state.pages[state.currentPageIndex] || [];

    // 1. Identifica os blocos da Página N + 1
    let nextPageBlocks = [];
    if (state.currentPageIndex + 1 < state.pages.length) {
      nextPageBlocks = state.pages[state.currentPageIndex + 1];
    } else if (state.currentChapterIndex + 1 < state.book.chapters.length) {
      // Se for a última página do capítulo, inspeciona o início do próximo capítulo
      const nextChapter = state.book.chapters[state.currentChapterIndex + 1];
      if (nextChapter && nextChapter.content_blocks) {
        nextPageBlocks = nextChapter.content_blocks.slice(0, 5);
      }
    }

    // 2. Busca audioTrigger na página seguinte (Página N + 1)
    const nextTriggerBlock = nextPageBlocks.find(
      (b) => b.audio_trigger && b.audio_trigger.track
    );

    if (nextTriggerBlock) {
      const track = nextTriggerBlock.audio_trigger.track;
      console.log(
        `🎵 [Skysync Lookahead] Gatilho antecipado detectado na Página ${state.currentPageIndex + 2}: ` +
        `'${track.title}' (§${nextTriggerBlock.order}). Iniciando crossfade antecipado...`
      );
      dispatchAudioTrigger(nextTriggerBlock, 300);
      return;
    }

    // 3. Fallback: se a página seguinte não contiver gatilho, mas a página atual contiver
    // um gatilho que ainda não está ativo no player
    const currentTriggerBlock = currentPageBlocks.find(
      (b) => b.audio_trigger && b.audio_trigger.track
    );
    if (currentTriggerBlock) {
      const trackId = currentTriggerBlock.audio_trigger.track.id;
      const lastTrackId = localStorage.getItem(STORAGE_KEYS.LAST_TRACK_ID);
      if (trackId !== lastTrackId) {
        console.log(
          `🎵 [Skysync Trigger] Gatilho presente na página atual: '${currentTriggerBlock.audio_trigger.track.title}'`
        );
        dispatchAudioTrigger(currentTriggerBlock, 1000);
      }
    }
  }

  function dispatchAudioTrigger(block, delayMs) {
    if (!block || !block.audio_trigger) return;
    const currentChapter = state.book.chapters[state.currentChapterIndex];

    const audioTriggerPayload = {
      ...block.audio_trigger,
      delay_ms: delayMs !== undefined ? delayMs : (block.audio_trigger.delay_ms || 1000),
    };

    window.dispatchEvent(
      new CustomEvent('skysync:paragraph-change', {
        detail: {
          paragraphId: block.id,
          chapterId: currentChapter ? currentChapter.id : null,
          block: block,
          audioTrigger: audioTriggerPayload,
        },
      })
    );
  }

  // --- NAVEGAÇÃO DE PÁGINAS ---
  function goToNextPage() {
    if (state.currentPageIndex < state.pages.length - 1) {
      state.currentPageIndex++;
      renderCurrentPage();
    } else if (state.currentChapterIndex < state.book.chapters.length - 1) {
      // Avança para a Página 1 do próximo capítulo
      openChapterByIndex(state.currentChapterIndex + 1, 0);
    }
  }

  function goToPreviousPage() {
    if (state.currentPageIndex > 0) {
      state.currentPageIndex--;
      renderCurrentPage();
    } else if (state.currentChapterIndex > 0) {
      // Retorna para a última página do capítulo anterior
      openChapterByIndex(state.currentChapterIndex - 1, 'last');
    }
  }

  function openChapter(chapterId, targetPageOrBlockId = 0) {
    if (!state.book || !state.book.chapters) return;
    const idx = state.book.chapters.findIndex((c) => c.id === chapterId);
    if (idx !== -1) {
      openChapterByIndex(idx, targetPageOrBlockId);
    }
  }

  function openChapterByIndex(index, targetPageOrBlockId = 0) {
    if (!state.book || !state.book.chapters) return;
    if (index < 0 || index >= state.book.chapters.length) return;

    state.currentChapterIndex = index;
    const chapter = state.book.chapters[index];

    // Calcula as páginas virtuais do capítulo
    state.pages = paginateChapter(chapter);

    // Posiciona na página correta
    if (targetPageOrBlockId === 'last') {
      state.currentPageIndex = Math.max(0, state.pages.length - 1);
    } else if (typeof targetPageOrBlockId === 'string') {
      const pIdx = state.pages.findIndex((page) =>
        page.some((b) => b.id === targetPageOrBlockId)
      );
      state.currentPageIndex = pIdx !== -1 ? pIdx : 0;
    } else if (typeof targetPageOrBlockId === 'number') {
      state.currentPageIndex = Math.max(0, Math.min(targetPageOrBlockId, state.pages.length - 1));
    } else {
      state.currentPageIndex = 0;
    }

    renderCurrentPage();
  }

  // --- RECALCULO AUTOMÁTICO DE LAYOUT (RESIZE E FONT SIZE) ---
  function repaginateAndRender(keepBlockId) {
    if (!state.book || !state.book.chapters) return;
    const chapter = state.book.chapters[state.currentChapterIndex];
    if (!chapter) return;

    const targetBlockId = keepBlockId || (state.pages[state.currentPageIndex]?.[0]?.id);

    state.pages = paginateChapter(chapter);

    if (targetBlockId) {
      const pIdx = state.pages.findIndex((page) =>
        page.some((b) => b.id === targetBlockId)
      );
      state.currentPageIndex = pIdx !== -1 ? pIdx : Math.min(state.currentPageIndex, state.pages.length - 1);
    } else {
      state.currentPageIndex = Math.min(state.currentPageIndex, state.pages.length - 1);
    }

    renderCurrentPage();
  }

  // --- RETOMADA DA LEITURA ---
  function restoreLastPosition() {
    const lastChapterId = localStorage.getItem(STORAGE_KEYS.LAST_CHAPTER);
    const lastParagraphId = localStorage.getItem(STORAGE_KEYS.LAST_PARAGRAPH);

    if (lastChapterId && state.book) {
      openChapter(lastChapterId, lastParagraphId || 0);
    } else if (state.book && state.book.chapters.length > 0) {
      openChapterByIndex(0, 0);
    }
  }

  function getSavedProgress() {
    const lastChapterId = localStorage.getItem(STORAGE_KEYS.LAST_CHAPTER);
    const lastParagraphId = localStorage.getItem(STORAGE_KEYS.LAST_PARAGRAPH);
    if (!lastChapterId && !lastParagraphId) return null;

    let chapterNumber = null;
    let chapterTitle = null;

    if (state.book && lastChapterId) {
      const ch = state.book.chapters.find((c) => c.id === lastChapterId);
      if (ch) {
        chapterNumber = ch.number;
        chapterTitle = ch.title;
      }
    }

    return {
      lastChapterId,
      lastParagraphId,
      chapterNumber,
      chapterTitle,
    };
  }

  // --- DRAWER / SUMÁRIO DINÂMICO COM ABAS ---
  function renderTableOfContents(chapters) {
    const prefaceChapter = chapters.find((c) => c.is_preface || c.id === 'cap-preface');
    const officialChapters = chapters.filter((c) => !c.is_preface && c.id !== 'cap-preface');

    // 1. Aba Prefácio
    if (elements.prefaceTocCard) {
      if (prefaceChapter) {
        elements.prefaceTocCard.innerHTML = `
          <div class="preface-item-box" id="toc-preface-item" data-chapter-id="${prefaceChapter.id}">
            <div class="preface-item-tag">✦ Manuscrito Preliminar ✦</div>
            <div class="preface-item-title">${escapeHtml(prefaceChapter.title)}</div>
            <div class="preface-item-meta">
              <span>📄 ${prefaceChapter.content_blocks.length} notas</span>
              <span>⏱️ ~${prefaceChapter.estimated_read_time_minutes} min</span>
            </div>
          </div>
        `;
        const item = elements.prefaceTocCard.querySelector('#toc-preface-item');
        if (item) {
          item.addEventListener('click', () => {
            openChapter(prefaceChapter.id, 0);
            toggleDrawer(false);
          });
        }
      } else {
        elements.prefaceTocCard.innerHTML = `<p style="color: var(--text-muted); padding: 16px;">Nenhum prefácio registrado.</p>`;
      }
    }

    // 2. Aba Capítulos (Capítulo 1 ao 25)
    let listHtml = '';
    officialChapters.forEach((chap) => {
      const triggerCount = chap.content_blocks.filter((b) => b.audio_trigger).length;
      listHtml += `
        <li class="chapter-item" data-chapter-id="${chap.id}">
          <div class="chapter-item-number">Capítulo ${chap.number}</div>
          <div class="chapter-item-title">${escapeHtml(chap.title)}</div>
          <div class="chapter-item-meta">
            <span>⏱️ ${chap.estimated_read_time_minutes} min</span>
            ${triggerCount > 0 ? `<span>🎵 ${triggerCount} trilhas</span>` : ''}
          </div>
        </li>
      `;
    });

    if (elements.chapterList) {
      elements.chapterList.innerHTML = listHtml;
      elements.chapterList.querySelectorAll('.chapter-item').forEach((item) => {
        item.addEventListener('click', () => {
          const chapterId = item.getAttribute('data-chapter-id');
          openChapter(chapterId, 0);
          toggleDrawer(false);
        });
      });
    }
  }

  function updateDrawerActiveChapter(chapterId) {
    if (elements.chapterList) {
      elements.chapterList.querySelectorAll('.chapter-item').forEach((item) => {
        const matches = item.getAttribute('data-chapter-id') === chapterId;
        item.classList.toggle('active', matches);
      });
    }
    if (elements.prefaceTocCard) {
      const prefItem = elements.prefaceTocCard.querySelector('.preface-item-box');
      if (prefItem) {
        const matches = prefItem.getAttribute('data-chapter-id') === chapterId;
        prefItem.classList.toggle('active', matches);
      }
    }
  }

  function switchDrawerTab(tabName) {
    const isPreface = tabName === 'preface';
    if (elements.drawerTabBtnPreface) {
      elements.drawerTabBtnPreface.classList.toggle('active', isPreface);
      elements.drawerTabBtnPreface.setAttribute('aria-selected', isPreface ? 'true' : 'false');
    }
    if (elements.drawerTabBtnChapters) {
      elements.drawerTabBtnChapters.classList.toggle('active', !isPreface);
      elements.drawerTabBtnChapters.setAttribute('aria-selected', !isPreface ? 'true' : 'false');
    }
    if (elements.drawerTabPreface) {
      elements.drawerTabPreface.style.display = isPreface ? 'block' : 'none';
    }
    if (elements.drawerTabChapters) {
      elements.drawerTabChapters.style.display = !isPreface ? 'block' : 'none';
    }
  }

  function toggleDrawer(open) {
    const isOpen = open !== undefined ? open : !elements.drawerPanel.classList.contains('open');
    elements.drawerPanel.classList.toggle('open', isOpen);
    elements.drawerOverlay.classList.toggle('open', isOpen);
  }

  // --- GERENCIAMENTO DE TEMAS E FONTES ---
  function applyTheme(themeName) {
    document.body.classList.remove('theme-sepia', 'theme-light');
    if (themeName === 'sepia') {
      document.body.classList.add('theme-sepia');
    } else if (themeName === 'light') {
      document.body.classList.add('theme-light');
    }
    state.currentTheme = themeName;
    localStorage.setItem(STORAGE_KEYS.THEME, themeName);

    elements.themeButtons.forEach((btn) => {
      const t = btn.getAttribute('data-theme');
      btn.classList.toggle('active', t === themeName);
    });
  }

  function applyFontSize(sizeRem, shouldRepaginate = true) {
    const clamped = Math.min(1.6, Math.max(0.95, sizeRem));
    state.fontSizeRem = clamped;
    document.documentElement.style.setProperty('--reader-font-size', `${clamped}rem`);
    localStorage.setItem(STORAGE_KEYS.FONT_SIZE, clamped.toString());

    if (shouldRepaginate && state.isLoaded) {
      const currentBlockId = localStorage.getItem(STORAGE_KEYS.LAST_PARAGRAPH);
      repaginateAndRender(currentBlockId);
    }
  }

  // --- EVENT LISTENERS (CLIQUE, TECLADO, TOUCH E RESIZE) ---
  function setupEventListeners() {
    // Áreas de Clique Laterais Invisíveis (Navegação Estilo Kindle - Requisito 1)
    if (elements.zonePrev) {
      elements.zonePrev.addEventListener('click', (e) => {
        e.preventDefault();
        goToPreviousPage();
      });
    }

    if (elements.zoneNext) {
      elements.zoneNext.addEventListener('click', (e) => {
        e.preventDefault();
        goToNextPage();
      });
    }

    // Navegação via Teclado (Setas Esquerda/Direita, Espaço, PageDown/PageUp)
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
        e.preventDefault();
        goToNextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
        e.preventDefault();
        goToPreviousPage();
      }
    });

    // Gestos de Deslize (Swipe Touch para Dispositivos Móveis)
    let touchStartX = 0;
    let touchStartY = 0;
    window.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches && e.touches[0]) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      },
      { passive: true }
    );

    window.addEventListener(
      'touchend',
      (e) => {
        if (!e.changedTouches || !e.changedTouches[0]) return;
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = e.changedTouches[0].clientY - touchStartY;

        if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
          if (deltaX < 0) {
            goToNextPage();
          } else {
            goToPreviousPage();
          }
        }
      },
      { passive: true }
    );

    // Redimensionamento da Janela (Resize - Requisito 1)
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!state.isLoaded || !state.book) return;
        const currentBlockId = localStorage.getItem(STORAGE_KEYS.LAST_PARAGRAPH);
        repaginateAndRender(currentBlockId);
      }, 150);
    });

    // Drawer / Sumário
    if (elements.btnToggleDrawer) {
      elements.btnToggleDrawer.addEventListener('click', () => toggleDrawer(true));
    }
    if (elements.btnCloseDrawer) {
      elements.btnCloseDrawer.addEventListener('click', () => toggleDrawer(false));
    }
    if (elements.drawerOverlay) {
      elements.drawerOverlay.addEventListener('click', () => toggleDrawer(false));
    }

    // Abas do Drawer
    if (elements.drawerTabBtnPreface) {
      elements.drawerTabBtnPreface.addEventListener('click', () => switchDrawerTab('preface'));
    }
    if (elements.drawerTabBtnChapters) {
      elements.drawerTabBtnChapters.addEventListener('click', () => switchDrawerTab('chapters'));
    }

    // Seletor de Tema
    elements.themeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const theme = btn.getAttribute('data-theme');
        applyTheme(theme);
      });
    });

    // Ajuste de Tipografia (A- / A+)
    if (elements.btnFontDecrease) {
      elements.btnFontDecrease.addEventListener('click', () => {
        applyFontSize(state.fontSizeRem - 0.1);
      });
    }

    if (elements.btnFontIncrease) {
      elements.btnFontIncrease.addEventListener('click', () => {
        applyFontSize(state.fontSizeRem + 0.1);
      });
    }
  }

  function showLoading() {
    elements.readerContent.innerHTML = `
      <div class="loading-view">
        <div class="spinner"></div>
        <p>Carregando Skyhaven com paginação estilo Kindle e Lookahead...</p>
      </div>
    `;
  }

  function showError(msg) {
    elements.readerContent.innerHTML = `
      <div class="error-view">
        <h2 style="color: #ef4444; margin-bottom: 12px;">⚠️ Não foi possível carregar o livro</h2>
        <p style="color: var(--text-secondary); margin-bottom: 20px;">${escapeHtml(msg)}</p>
        <button class="btn-control" onclick="location.reload()">Tentar Novamente</button>
      </div>
    `;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- API PÚBLICA EXPORTADA ---
  window.SkysyncReader = {
    getBook: () => state.book,
    getCurrentChapter: () => state.book?.chapters?.[state.currentChapterIndex] || null,
    getCurrentPage: () => state.currentPageIndex,
    getTotalPages: () => state.pages.length,
    goToNextPage,
    goToPreviousPage,
    openChapter,
    openChapterByIndex,
    repaginate: repaginateAndRender,
    restoreLastPosition,
    getSavedProgress,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
