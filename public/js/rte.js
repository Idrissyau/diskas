/**
 * rte.js — Lightweight Rich Text Editor (no dependencies)
 * Attaches a formatting toolbar to any <textarea data-rte>
 * Also exposes window.initRTE(textarea) for manual/modal init.
 */
(function () {
  'use strict';

  /* ── Toolbar definition ─────────────────────────────────────────────── */
  const TOOLS = [
    { cmd: 'bold',               icon: 'fa-bold',          title: 'Bold (Ctrl+B)' },
    { cmd: 'italic',             icon: 'fa-italic',        title: 'Italic (Ctrl+I)' },
    { cmd: 'underline',          icon: 'fa-underline',     title: 'Underline (Ctrl+U)' },
    { sep: true },
    { cmd: 'formatBlock', val: 'H1', label: 'H1', title: 'Heading 1' },
    { cmd: 'formatBlock', val: 'H2', label: 'H2', title: 'Heading 2' },
    { cmd: 'formatBlock', val: 'H3', label: 'H3', title: 'Heading 3' },
    { cmd: 'formatBlock', val: 'H4', label: 'H4', title: 'Heading 4' },
    { cmd: 'formatBlock', val: 'H5', label: 'H5', title: 'Heading 5' },
    { cmd: 'formatBlock', val: 'P',  label: 'P',  title: 'Paragraph' },
    { sep: true },
    { cmd: 'insertUnorderedList', icon: 'fa-list-ul',      title: 'Bullet List' },
    { cmd: 'insertOrderedList',   icon: 'fa-list-ol',      title: 'Numbered List' },
    { cmd: 'formatBlock', val: 'BLOCKQUOTE', icon: 'fa-quote-left', title: 'Blockquote' },
    { sep: true },
    { cmd: 'createLink',          icon: 'fa-link',         title: 'Insert Link' },
    { cmd: 'removeFormat',        icon: 'fa-remove-format',title: 'Clear Formatting' },
  ];

  /* ── Init a single textarea ─────────────────────────────────────────── */
  function initRTE(textarea) {
    if (!textarea || textarea.dataset.rteInit) return;
    textarea.dataset.rteInit = '1';

    /* Outer wrapper */
    const wrap = document.createElement('div');
    wrap.className = 'rte-wrap';

    /* Toolbar */
    const bar = document.createElement('div');
    bar.className = 'rte-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Text formatting');

    TOOLS.forEach(tool => {
      if (tool.sep) {
        const s = document.createElement('span');
        s.className = 'rte-sep';
        bar.appendChild(s);
        return;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rte-btn';
      btn.title = tool.title;
      btn.setAttribute('aria-label', tool.title);
      if (tool.label) {
        btn.textContent = tool.label;
        btn.dataset.label = '1';
      } else {
        btn.innerHTML = `<i class="fa-solid ${tool.icon}" aria-hidden="true"></i>`;
      }
      btn.addEventListener('mousedown', e => {
        e.preventDefault(); // keep focus in editor
        if (tool.cmd === 'createLink') {
          const url = prompt('Enter URL (e.g. https://example.com):');
          if (url) document.execCommand('createLink', false, url);
        } else if (tool.val) {
          document.execCommand(tool.cmd, false, tool.val);
        } else {
          document.execCommand(tool.cmd, false, null);
        }
        editor.focus();
        sync();
      });
      bar.appendChild(btn);
    });

    /* Editable area */
    const editor = document.createElement('div');
    editor.className = 'rte-editor';
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    editor.setAttribute('spellcheck', 'true');
    // Load initial content
    editor.innerHTML = textarea.value || '';

    /* Sync helper */
    function sync() {
      textarea.value = editor.innerHTML;
    }

    editor.addEventListener('input', sync);
    editor.addEventListener('blur',  sync);
    // Handle paste — strip external styles but keep structure
    editor.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/html')
        || (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertHTML', false, text);
      sync();
    });

    /* Placeholder support */
    const ph = textarea.getAttribute('placeholder');
    if (ph) {
      editor.dataset.ph = ph;
      editor.style.setProperty('--rte-ph', JSON.stringify(ph));
    }

    /* Assemble: wrap → bar + editor, hide original textarea */
    wrap.appendChild(bar);
    wrap.appendChild(editor);
    textarea.style.display = 'none';
    textarea.parentNode.insertBefore(wrap, textarea);

    /* Public API attached to textarea */
    textarea._rte = {
      getValue: () => editor.innerHTML,
      setValue: v  => { editor.innerHTML = v || ''; sync(); },
      focus:    ()  => editor.focus(),
    };

    return textarea._rte;
  }

  /* ── Auto-init on DOM ready ─────────────────────────────────────────── */
  function autoInit() {
    document.querySelectorAll('textarea[data-rte]').forEach(initRTE);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  /* ── Expose globally ────────────────────────────────────────────────── */
  window.initRTE    = initRTE;
  window.autoInitRTE = autoInit;
})();
