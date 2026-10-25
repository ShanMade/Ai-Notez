// Enhanced Markdown renderer with comprehensive support
// Handles tables, code blocks, lists, headings, links, etc.
// Secure against XSS attacks

(function() {
  'use strict';

  // HTML escaping
  function esc(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Safe URL validation - only allow http, https, and safe relative URLs
  function isSafeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim().toLowerCase();
    
    // Block dangerous schemes
    if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return false;
    
    // Allow http, https
    if (/^https?:\/\//i.test(trimmed)) return true;
    
    // Allow relative URLs, mailto, and anchor links
    return /^(\/|#|mailto:|\.\/)/i.test(trimmed);
  }

  // Sanitize HTML attributes to prevent injection
  function sanitizeAttr(value) {
    if (!value) return '';
    return String(value)
      .replace(/["'<>\s]/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .slice(0, 500);
  }

  // Parse table alignment from separator row
  function parseTableAlignment(separator) {
    if (!separator) return [];
    const parts = separator.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    return parts.map(part => {
      const trimmed = part.trim();
      if (/^:---+:?$/.test(trimmed)) return 'center';
      if (/^---+:?$/.test(trimmed)) return 'right';
      if (/^:?---+$/.test(trimmed)) return 'left';
      return 'left';
    });
  }

  // Check if prefers reduced motion
  function prefersReducedMotion() {
    if (typeof window === 'undefined') return true;
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return true;
    }
  }

  // ---- Math ---------------------------------------------------------------
  // Study notes and answers are full of LaTeX: \(T(K)=t°C+273.15\),
  // \[E=mc^2\], \begin{aligned}...\end{aligned}. Markdown would eat the
  // backslashes, underscores and asterisks inside it, so math is lifted out of
  // the source first, rendered with KaTeX once the HTML exists, and swapped
  // back in. Code spans are left alone.
  function looksLikeMath(tex) {
    const body = String(tex == null ? '' : tex);
    if (!body || body.length > 240) return false;
    if (/^\s|\s$/.test(body)) return false;              // "$ 5 $" is not math
    if (/^\d+(?:[.,]\d+)?$/.test(body)) return false;     // "$5$" is a price
    return /[\\^_={}]/.test(body) || /^[A-Za-z]$/.test(body);
  }

  function protectMath(source, bag, seed) {
    if (!source) return source;
    // Fenced blocks and inline code stay literal, math inside them included.
    const segments = [];
    const codeRe = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;
    let last = 0;
    let match;
    while ((match = codeRe.exec(source))) {
      segments.push({ text: source.slice(last, match.index), code: false });
      segments.push({ text: match[0], code: true });
      last = codeRe.lastIndex;
    }
    segments.push({ text: source.slice(last), code: false });
    const stash = tex => `${seed}m${bag.push(tex) - 1}z`;
    return segments.map(segment => {
      if (segment.code) return segment.text;
      let text = segment.text;
      const display = tex => stash({ tex: tex.trim(), display: true });
      const inline = tex => stash({ tex: tex.trim(), display: false });
      text = text.replace(/\$\$([\s\S]{1,4000}?)\$\$/g, (_, tex) => display(tex));
      text = text.replace(/\\\[([\s\S]{1,4000}?)\\\]/g, (_, tex) => display(tex));
      text = text.replace(/\\\(([\s\S]{1,4000}?)\\\)/g, (_, tex) => inline(tex));
      text = text.replace(/\\begin\{([A-Za-z*]+)\}([\s\S]{1,4000}?)\\end\{\1\}/g, full => display(full));
      text = text.replace(/\$([^$\n]{1,240}?)\$/g, (full, tex) => (looksLikeMath(tex) ? inline(tex) : full));
      return text;
    }).join('');
  }

  // Streaming re-renders the same formulas on every chunk; a tiny cache keeps
  // that cheap without growing without bound.
  const mathCache = new Map();
  function renderMath(tex, display) {
    const key = `${display ? 'd' : 'i'}:${tex}`;
    const cached = mathCache.get(key);
    if (cached) return cached;
    const katex = typeof window !== 'undefined' ? window.katex : null;
    if (katex && typeof katex.renderToString === 'function') {
      try {
        const rendered = katex.renderToString(tex, {
          displayMode: !!display,
          throwOnError: false,
          strict: 'ignore',
          trust: false,
          maxSize: 12,
          maxExpand: 200
        });
        if (mathCache.size > 400) mathCache.clear();
        mathCache.set(key, rendered);
        return rendered;
      } catch {}
    }
    // KaTeX missing or unhappy: show the source rather than a broken formula.
    return `<code class="nz-math-src">${esc(tex)}</code>`;
  }

  function restoreMath(html, bag, seed) {
    if (!bag.length || !html) return html;
    const pattern = new RegExp(`${seed}m(\\d+)z`, 'g');
    return html.replace(pattern, (full, index) => {
      const item = bag[Number(index)];
      return item ? renderMath(item.tex, item.display) : full;
    });
  }

  // Main markdown to HTML function
  // A transcript part can arrive with the provider's own speaker label
  // ("spk0:", "spk_1:", "Speaker B:") when a model ignores the "Voice n"
  // instruction. Rendering rewrites those at the start of a line, so an older
  // note that already stored one reads as "Voice 1:" instead of leaking the
  // raw label into the reader.
  function normalizeSpeakerLabels(text) {
    const source = String(text || '');
    // A recording is numbered one way throughout: if any part says "spk0" the
    // labels count from zero, otherwise Gemini's "spk_1" already starts at one.
    const zeroBased = /(?:^|\n)\s*(?:\[[\d:]{3,12}\]\s*)?\**\s*spk[\s_-]*0\s*\**\s*[:\uFF1A]/i.test(source);
    return source.split('\n').map(line => {
      const numbered = /^(\s*(?:\[[\d:]+\]\s*)?)\**\s*(spk|voice|speaker|person)[\s_-]*([0-9\u0660-\u0669]{1,2})\s*\**\s*(?:[:\uFF1A]|\s+[-–—]\s+)\s*\**\s*/i;
      const lettered = /^(\s*(?:\[[\d:]+\]\s*)?)\**\s*(?:speaker|person|voice)\s*([A-Za-z])\s*\**\s*(?:[:\uFF1A]|\s+[-–—]\s+)\s*\**\s*/i;
      let match = line.match(numbered);
      if (match) {
        const digits = String(match[3]).replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660));
        const shift = /^spk$/i.test(match[2]) && zeroBased ? 1 : 0;
        return `${match[1]}Voice ${Math.max(1, Number(digits) + shift)}: ${line.slice(match[0].length)}`;
      }
      match = line.match(lettered);
      if (match) return `${match[1]}Voice ${match[2].toUpperCase().charCodeAt(0) - 64}: ${line.slice(match[0].length)}`;
      return line;
    }).join('\n');
  }
  window.nzNormalizeSpeakerLabels = normalizeSpeakerLabels;
  window.markdownToHtmlSafe = function markdownToHtmlSafe(markdown) {
    markdown = normalizeSpeakerLabels(markdown);
    const inline = source => {
      if (!source) return '';
      let text = source;  // Do NOT escape here - escape matched content in replacements
      
      // Inline code
      text = text.replace(/`([^`]+)`/g, (_, inner) => `<code>${esc(inner)}</code>`);
      
      // Wiki links (internal note links)
      text = text.replace(/\[\[([^\]]+)\]\]/g, (_, title) => 
        `<a href="#" class="nz-wiki" data-wiki="${esc(title.trim())}">${esc(title.trim())}</a>`);
      
      // Bold
      text = text.replace(/\*\*([^*]+)\*\*/g, (_, inner) => `<strong>${esc(inner)}</strong>`);
      text = text.replace(/__([^_]+)__/g, (_, inner) => `<strong>${esc(inner)}</strong>`);
      
      // Italic
      text = text.replace(/(^|[^*])\*([^*]+)\*/g, (_, prefix, inner) => `${prefix}<em>${esc(inner)}</em>`);
      text = text.replace(/(^|[^_])_([^_]+)_/g, (_, prefix, inner) => `${prefix}<em>${esc(inner)}</em>`);
      
      // Links - with security check
      text = text.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (match, linkText, url) => {
        if (isSafeUrl(url)) {
          return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(linkText)}</a>`;
        }
        return esc(linkText);
      });
      
      return text;
    };

    const math = [];
    const mathSeed = `nzm${Math.random().toString(36).slice(2, 8)}`;
    const source = protectMath(String(markdown || ''), math, mathSeed);
    const lines = source.replace(/\r/g, '').split('\n');
    const output = [];
    let paragraph = [];
    let listType = '';
    let code = false;
    let codeLines = [];
    let quoteLines = [];
    let inTable = false;
    let tableRows = [];
    let currentRow = [];
    let tableAlign = [];
    let inFencedCode = false;
    let codeLanguage = '';

    const closeList = () => { 
      if (listType) { 
        output.push(`</${listType}>`); 
        listType = ''; 
      } 
    };

    const flushParagraph = () => { 
      if (paragraph.length) { 
        output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); 
        paragraph = []; 
      } 
    };

    const flushQuote = () => { 
      if (quoteLines.length) { 
        output.push(`<blockquote>${quoteLines.map(line => `<p>${inline(line)}</p>`).join('')}</blockquote>`); 
        quoteLines = []; 
      } 
    };

    const flushTable = () => {
      if (!inTable || tableRows.length === 0) return;
      
      let html = '<table class="markdown-table"><thead><tr>';
      
      // Add header row
      if (tableRows.length > 0) {
        tableRows[0].forEach((cell, idx) => {
          const align = tableAlign[idx] || 'left';
          html += `<th style="text-align:${align}">${inline(cell)}</th>`;
        });
        html += '</tr></thead><tbody>';
        
        // Add data rows
        for (let i = 1; i < tableRows.length; i++) {
          html += '<tr>';
          tableRows[i].forEach((cell, idx) => {
            const align = tableAlign[idx] || 'left';
            html += `<td style="text-align:${align}">${inline(cell)}</td>`;
          });
          html += '</tr>';
        }
        html += '</tbody></table>';
      }
      
      output.push(html);
      inTable = false;
      tableRows = [];
      currentRow = [];
      tableAlign = [];
    };

    const flushFencedCode = () => {
      if (!inFencedCode || codeLines.length === 0) return;
      const codeContent = codeLines.join('\n');
      const languageClass = codeLanguage ? ` class="language-${sanitizeAttr(codeLanguage)}"` : '';
      output.push(`<pre><code${languageClass}>${esc(codeContent)}</code></pre>`);
      codeLines = [];
      codeLanguage = '';
      inFencedCode = false;
    };

    for (const line of lines) {
      // Handle fenced code blocks (```)
      const fencedCodeStart = line.match(/^(\s*)```(\w*)\s*$/);
      const fencedCodeEnd = /^\s*```\s*$/.test(line);
      
      if (fencedCodeStart && !inFencedCode) {
        flushParagraph();
        closeList();
        flushQuote();
        flushTable();
        inFencedCode = true;
        codeLanguage = (fencedCodeStart[2] || '').toLowerCase();
        codeLines = [];
        continue;
      }
      
      if (fencedCodeEnd && inFencedCode) {
        flushFencedCode();
        continue;
      }
      
      if (inFencedCode) {
        codeLines.push(line);
        continue;
      }

      // A blank line ends a table. Without this, two tables written one after
      // the other were merged into one, and the second header became a row.
      if (inTable && !line.trim()) {
        flushTable();
        continue;
      }

      // Handle table rows
      const tableSep = line.match(/^\s*\|?\s*[-:]+[-:\s]*\|[-:]+[-:\s]*\|?\s*$/);
      
      if (tableSep && inTable && tableRows.length === 1) {
        // This is the separator row - parse alignment
        const sep = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
        tableAlign = sep.map(col => {
          const trimmed = col.trim();
          if (/^:---+:?$/.test(trimmed)) return 'center';
          if (/^---+:?$/.test(trimmed)) return 'right';
          if (/^:?---+$/.test(trimmed)) return 'left';
          return 'left';
        });
        continue;
      }
      
      // Check if this line is a table row (contains | and is not a separator)
      const isTableRow = /^\s*\|/.test(line) && /\|\s*$/.test(line);
      
      if (isTableRow && !tableSep) {
        flushParagraph();
        closeList();
        flushQuote();
        
        if (!inTable) {
          inTable = true;
          tableRows = [];
          tableAlign = [];
        }
        
        // Parse table cells
        const trimmed = line.trim();
        let cells = trimmed.split('|').map(c => c.trim());
        
        // Remove empty first/last cells if they're from leading/trailing pipes
        if (cells.length > 0 && cells[0] === '') cells = cells.slice(1);
        if (cells.length > 0 && cells[cells.length - 1] === '') cells = cells.slice(0, -1);
        
        currentRow = cells;
        tableRows.push(currentRow);
        currentRow = [];
        continue;
      }
      
      // Handle regular markdown (not in table or fenced code)
      if (!inTable && !inFencedCode) {
        // Old-style code blocks (indented with 4 spaces or tab)
        if (/^\s*```/.test(line)) {
          flushParagraph();
          closeList();
          flushQuote();
          flushTable();
          if (code) { 
            output.push(`<pre><code>${esc(codeLines.join('\n'))}</code></pre>`); 
            codeLines = []; 
            code = false; 
          } else {
            code = true;
          }
          continue;
        }
        
        if (code) { 
          codeLines.push(line); 
          continue; 
        }
        
        if (!line.trim()) { 
          flushParagraph(); 
          closeList(); 
          flushQuote(); 
          flushTable(); 
          continue; 
        }
        
        const heading = line.match(/^\s{0,3}(#{1,4})\s+(.+)$/);
        if (heading) { 
          flushParagraph(); 
          closeList(); 
          flushQuote(); 
          flushTable(); 
          const level = Math.min(6, heading[1].length); // Support h1-h6
          output.push(`<h${level}>${inline(heading[2])}</h${level}>`); 
          continue; 
        }
        
        if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { 
          flushParagraph(); 
          closeList(); 
          flushQuote(); 
          flushTable(); 
          output.push('<hr>'); 
          continue; 
        }
        
        if (/^\s*>/.test(line)) { 
          flushParagraph(); 
          closeList(); 
          flushTable(); 
          quoteLines.push(line.replace(/^\s*>\s?/, '')); 
          continue; 
        }
        
        const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
        const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
        
        if (bullet || numbered) {
          flushParagraph(); 
          flushQuote(); 
          flushTable();
          const nextType = bullet ? 'ul' : 'ol';
          if (listType && listType !== nextType) closeList();
          if (!listType) { 
            listType = nextType; 
            output.push(`<${listType}>`); 
          }
          const rawItem = (bullet || numbered)[1];
          const check = rawItem.match(/^\[([ xX])\]\s+(.*)$/);
          output.push(`<li>${check ? `<span aria-label="${check[1].trim() ? 'complete' : 'incomplete'}">${check[1].trim() ? '\u2611' : '\u2610'}</span> ${inline(check[2])}` : inline(rawItem)}</li>`);
          continue;
        }
        
        closeList(); 
        flushQuote(); 
        flushTable(); 
        paragraph.push(line.trim());
      }
    }

    // Flush any remaining content
    if (inFencedCode) {
      flushFencedCode();
    }
    if (code && !inFencedCode) { 
      output.push(`<pre><code>${esc(codeLines.join('\n'))}</code></pre>`); 
    }
    flushParagraph(); 
    closeList(); 
    flushQuote(); 
    flushTable();

    const result = restoreMath(output.join('\n'), math, mathSeed);
    return result || '<p class="subtle">There is no content in this note yet. Select <strong>Edit</strong> to add your first thought.</p>';
  };

  // Set markdownToHtml to use the safe renderer
  window.markdownToHtml = window.markdownToHtmlSafe;
})();
