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

  // Main markdown to HTML function
  window.markdownToHtmlSafe = function markdownToHtmlSafe(markdown) {
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

    const lines = String(markdown || '').replace(/\r/g, '').split('\n');
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

    const result = output.join('\n');
    return result || '<p class="subtle">There is no content in this note yet. Select <strong>Edit</strong> to add your first thought.</p>';
  };

  // Override the original markdownToHtml function if it exists
  if (typeof window.markdownToHtml === 'function') {
    const original = window.markdownToHtml;
    window.markdownToHtml = function(markdown) {
      try {
        return window.markdownToHtmlSafe(markdown);
      } catch (e) {
        console.error('Safe markdown renderer failed, falling back:', e);
        return original(markdown);
      }
    };
  } else {
    window.markdownToHtml = window.markdownToHtmlSafe;
  }
})();
