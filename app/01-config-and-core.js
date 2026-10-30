
    // Firebase web config - direct configuration for production
    const firebaseConfig = {
      apiKey: "AIzaSyAsyIrC2sPwtJcqg8x3_i-NgTEKvggGuUQ",
      authDomain: "ai-notez.firebaseapp.com",
      databaseURL: "https://ai-notez-default-rtdb.firebaseio.com",
      projectId: "ai-notez",
      storageBucket: "ai-notez.firebasestorage.app",
      messagingSenderId: "275128405663",
      appId: "1:275128405663:web:ee5864b447e839c2b35caa"
    };

    // Load voice profiles script
    const voiceProfilesScript = document.createElement('script');
    voiceProfilesScript.src = 'app/07-voice-profiles.js';
    voiceProfilesScript.async = false;
    document.head.appendChild(voiceProfilesScript);

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    $('.search-shortcut').textContent = /Mac|iPhone|iPad/i.test(navigator.platform || '') ? '⌘ K' : 'Ctrl K';
    // ================= Icon system =================
    // One geometry for the whole app: a 24px grid, 1.7px strokes, round caps and
    // joins, no filled shapes except deliberate dots. Every icon is drawn on the
    // same optical weight so a toolbar of mixed glyphs reads as one set.
    const NZ_ICON_PATHS = {
      // documents
      note: '<path d="M6.75 3.75h6.9L18 8.1v12.15H6.75z"/><path d="M13.4 3.9v4.35h4.35M9.6 12.7h5.6M9.6 16.1h5.6"/>',
      markdown: '<rect x="3.75" y="5.75" width="16.5" height="12.5" rx="2.4"/><path d="m6.9 14.6 1.9-4.6 1.9 4.6M7.5 13.2h2.6M13.6 10v4.6l1.6-2 1.6 2V10"/>',
      html: '<path d="m8.4 7.6-4.2 4.4 4.2 4.4M15.6 7.6l4.2 4.4-4.2 4.4M13.4 5.4l-2.8 13.2"/>',
      pdf: '<path d="M6.75 3.75h6.9L18 8.1v12.15H6.75z"/><path d="M13.4 3.9v4.35h4.35M9.3 16.4v-4.1h1.5a1.15 1.15 0 0 1 0 2.3H9.3M13.4 12.3v4.1h1.15a1.85 1.85 0 0 0 0-4.1z"/>',
      image: '<rect x="3.75" y="5.25" width="16.5" height="13.5" rx="2.4"/><circle cx="8.7" cy="10" r="1.45"/><path d="m4.4 16.9 4.3-4.05 3.5 3.15 2.6-2.35 4.5 4.3"/>',
      audio: '<path d="M11.2 5.4 6.9 9.05H4v5.9h2.9l4.3 3.65z"/><path d="M14.9 9.2a3.9 3.9 0 0 1 0 5.6M17.6 6.6a7.7 7.7 0 0 1 0 10.8"/>',
      video: '<rect x="3.4" y="5.9" width="12.8" height="12.2" rx="2.4"/><path d="m16.2 10.4 4.4-2.2v7.6l-4.4-2.2z"/><path d="m8.1 10.1 3.6 1.9-3.6 1.9z"/>',
      file: '<path d="M6.75 3.75h6.9L18 8.1v12.15H6.75z"/><path d="M13.4 3.9v4.35h4.35"/>',
      book: '<path d="M4 5.4a1.8 1.8 0 0 1 1.8-1.8h4.7v16.8H5.8A1.8 1.8 0 0 1 4 18.6z"/><path d="M20 5.4a1.8 1.8 0 0 0-1.8-1.8h-4.7v16.8h4.7a1.8 1.8 0 0 0 1.8-1.8z"/><path d="M6.8 7.6h1.5M15.7 7.6h1.5"/>',
      // structure
      folder: '<path d="M3.6 7.4a2.1 2.1 0 0 1 2.1-2.1h3.6l1.9 2.1h5.1a2.1 2.1 0 0 1 2.1 2.1v7.4a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z"/><path d="M3.9 9.9h16.2"/>',
      folderPlus: '<path d="M3.6 7.4a2.1 2.1 0 0 1 2.1-2.1h3.6l1.9 2.1h5.1a2.1 2.1 0 0 1 2.1 2.1v7.4a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z"/><path d="M12 11.6v4.8M9.6 14h4.8"/>',
      layers: '<path d="m12 3.6 8.2 4.3-8.2 4.3-8.2-4.3z"/><path d="m3.8 12.4 8.2 4.3 8.2-4.3M3.8 16.5l8.2 4.3 8.2-4.3"/>',
      grid: '<rect x="4" y="4" width="6.4" height="6.4" rx="1.6"/><rect x="13.6" y="4" width="6.4" height="6.4" rx="1.6"/><rect x="4" y="13.6" width="6.4" height="6.4" rx="1.6"/><rect x="13.6" y="13.6" width="6.4" height="6.4" rx="1.6"/>',
      list: '<path d="M9.2 6.2h10.3M9.2 12h10.3M9.2 17.8h10.3"/><circle cx="4.9" cy="6.2" r="1.05" fill="currentColor" stroke="none"/><circle cx="4.9" cy="12" r="1.05" fill="currentColor" stroke="none"/><circle cx="4.9" cy="17.8" r="1.05" fill="currentColor" stroke="none"/>',
      // actions
      spark: '<path d="M12 3.4c.55 4.2 1.9 5.55 6.1 6.1-4.2.55-5.55 1.9-6.1 6.1-.55-4.2-1.9-5.55-6.1-6.1 4.2-.55 5.55-1.9 6.1-6.1Z"/><path d="M17.9 15.2c.3 2.05.95 2.7 3 3-2.05.3-2.7.95-3 3-.3-2.05-.95-2.7-3-3 2.05-.3 2.7-.95 3-3Z"/>',
      plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
      close: '<path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6"/>',
      check: '<path d="m4.9 12.4 4.7 4.7L19.1 7.5"/>',
      search: '<circle cx="10.9" cy="10.9" r="6.65"/><path d="m15.9 15.9 4.3 4.3"/>',
      more: '<circle cx="5.4" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="18.6" cy="12" r="1.35" fill="currentColor" stroke="none"/>',
      moreVert: '<circle cx="12" cy="5.4" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="18.6" r="1.35" fill="currentColor" stroke="none"/>',
      chevronDown: '<path d="m6.5 9.4 5.5 5.5 5.5-5.5"/>',
      chevronRight: '<path d="m9.6 6.2 5.8 5.8-5.8 5.8"/>',
      chevronUp: '<path d="m6.5 14.6 5.5-5.5 5.5 5.5"/>',
      arrowLeft: '<path d="M19 12H5.4M11 5.6 4.8 12l6.2 6.4"/>',
      arrowRight: '<path d="M5 12h13.6M13 5.6 19.2 12 13 18.4"/>',
      arrowUpRight: '<path d="M7.4 16.6 16.6 7.4M8.7 7.4h7.9v7.9"/>',
      send: '<path d="M20.4 3.6 3.9 10.2c-.8.3-.8 1.5 0 1.8l6.3 2.2 2.2 6.3c.3.8 1.5.8 1.8 0z"/><path d="m10.2 14.2 4.5-4.5"/>',
      copy: '<rect x="8.6" y="8.6" width="11.4" height="11.4" rx="2.2"/><path d="M15.6 8.6V6.2A2.2 2.2 0 0 0 13.4 4H6.2A2.2 2.2 0 0 0 4 6.2v7.2a2.2 2.2 0 0 0 2.2 2.2h2.4"/>',
      refresh: '<path d="M20.2 11.4a8.2 8.2 0 1 0-2.5 6.4"/><path d="M20.4 4.6v6.8h-6.8"/>',
      trash: '<path d="M4.4 7.1h15.2M9.7 7.1V4.4h4.6v2.7M6.4 7.1l.85 12.2a1.6 1.6 0 0 0 1.6 1.5h6.3a1.6 1.6 0 0 0 1.6-1.5l.85-12.2"/><path d="M10.5 10.7v6.5M13.5 10.7v6.5"/>',
      edit: '<path d="M15.2 4.6a2.35 2.35 0 0 1 3.3 3.3L8.2 18.2l-4.4 1.1 1.1-4.4z"/><path d="m13.9 5.9 3.3 3.3"/>',
      pen: '<path d="M15.2 4.6a2.35 2.35 0 0 1 3.3 3.3L8.2 18.2l-4.4 1.1 1.1-4.4z"/>',
      download: '<path d="M12 4.2v10.1M7.9 10.3 12 14.4l4.1-4.1M4.8 16.6v2.3a1.3 1.3 0 0 0 1.3 1.3h11.8a1.3 1.3 0 0 0 1.3-1.3v-2.3"/>',
      upload: '<path d="M12 14.6V4.5M7.9 8.6 12 4.5l4.1 4.1M4.8 16.6v2.3a1.3 1.3 0 0 0 1.3 1.3h11.8a1.3 1.3 0 0 0 1.3-1.3v-2.3"/>',
      external: '<path d="M13.4 4.6h6v6M19.4 4.6 10.6 13.4"/><path d="M17.8 14v4.4a1.6 1.6 0 0 1-1.6 1.6H5.8a1.6 1.6 0 0 1-1.6-1.6V8a1.6 1.6 0 0 1 1.6-1.6H10"/>',
      move: '<path d="M4 7.4h11.3m-3.4-3.5 3.5 3.5-3.5 3.5M20 16.6H8.7m3.4 3.5-3.4-3.5 3.4-3.5"/>',
      star: '<path d="m12 3.9 2.62 5.32 5.88.86-4.25 4.14 1 5.86L12 17.31l-5.25 2.77 1-5.86L3.5 10.08l5.88-.86z"/>',
      pin: '<path d="M9.4 3.9h5.2l-.75 5.1 3.05 3.05H7.1l3.05-3.05z"/><path d="M12 12.05V20.1"/>',
      clock: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.3V12l3.2 1.9"/>',
      history: '<path d="M3.7 12a8.3 8.3 0 1 0 2.5-5.9L3.5 8.5"/><path d="M3.4 3.9v4.6h4.6M12 7.4V12l3.4 2"/>',
      settings: '<circle cx="12" cy="12" r="2.9"/><path d="M19.1 14.4a1.5 1.5 0 0 0 .3 1.65l.05.05a1.8 1.8 0 1 1-2.55 2.55l-.05-.05a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.37v.13a1.8 1.8 0 1 1-3.6 0v-.07a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.05.05a1.8 1.8 0 1 1-2.55-2.55l.05-.05a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.9h-.13a1.8 1.8 0 1 1 0-3.6h.07a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.05-.05a1.8 1.8 0 1 1 2.55-2.55l.05.05a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .9-1.37v-.13a1.8 1.8 0 1 1 3.6 0v.07a1.5 1.5 0 0 0 .9 1.37 1.5 1.5 0 0 0 1.65-.3l.05-.05a1.8 1.8 0 1 1 2.55 2.55l-.05.05a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.9h.13a1.8 1.8 0 1 1 0 3.6h-.07a1.5 1.5 0 0 0-1.37.9z"/>',
      key: '<circle cx="8.1" cy="15.9" r="3.4"/><path d="m10.6 13.4 8.1-8.1M16.3 7.7l2 2M14.1 9.9l2 2"/>',
      lock: '<rect x="4.9" y="10.4" width="14.2" height="9.4" rx="2.3"/><path d="M8.3 10.4V7.8a3.7 3.7 0 0 1 7.4 0v2.6M12 14.2v2.4"/>',
      shield: '<path d="M12 3.6 5 6.4v5.1c0 4.1 2.8 7.6 7 8.9 4.2-1.3 7-4.8 7-8.9V6.4z"/><path d="m9.1 11.9 2.1 2.1 3.8-3.9"/>',
      globe: '<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8M12 3.6c2.2 2.3 3.4 5.3 3.4 8.4S14.2 18.1 12 20.4c-2.2-2.3-3.4-5.3-3.4-8.4S9.8 5.9 12 3.6Z"/>',
      theme: '<path d="M20.3 15.2A8.4 8.4 0 0 1 8.8 3.7 8.6 8.6 0 1 0 20.3 15.2Z"/>',
      sun: '<circle cx="12" cy="12" r="4.1"/><path d="M12 2.7v2.2M12 19.1v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.7 12h2.2M19.1 12h2.2M4.4 19.6 6 18M18 6l1.6-1.6"/>',
      moon: '<path d="M20.3 15.2A8.4 8.4 0 0 1 8.8 3.7 8.6 8.6 0 1 0 20.3 15.2Z"/>',
      // AI + study
      mic: '<rect x="9.1" y="2.9" width="5.8" height="11.6" rx="2.9"/><path d="M5.4 11.2a6.6 6.6 0 0 0 13.2 0M12 17.8v3.3M8.6 21.1h6.8"/>',
      stop: '<rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.6" fill="currentColor" stroke="none"/>',
      pause: '<rect x="7.6" y="5.2" width="3.4" height="13.6" rx="1.5" fill="currentColor" stroke="none"/><rect x="13" y="5.2" width="3.4" height="13.6" rx="1.5" fill="currentColor" stroke="none"/>',
      play: '<path d="M8.2 5.4 18.6 12 8.2 18.6z"/>',
      bulb: '<path d="M9.2 18.1h5.6M10.2 20.9h3.6"/><path d="M12 3.1a6.1 6.1 0 0 0-3.6 11.05c.6.45.95 1.15.95 1.9v.25h5.3v-.25c0-.75.35-1.45.95-1.9A6.1 6.1 0 0 0 12 3.1Z"/>',
      quiz: '<circle cx="12" cy="12" r="8.4"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.65.35-.95.85-.95 1.6M12 17v.1"/>',
      cards: '<rect x="3.9" y="5.4" width="16.2" height="13.6" rx="2.4"/><path d="M7.9 10.2h8.2M7.9 13.8h5.4"/>',
      checkList: '<path d="M9.6 6.4h10M9.6 12h10M9.6 17.6h10"/><path d="m3.4 6.2 1.4 1.4 2.4-2.6M3.4 17.4l1.4 1.4 2.4-2.6"/>',
      spell: '<path d="M3.6 19.4 8.7 5.2l5.1 14.2M5.4 14.6h6.6"/><path d="M16.6 19.4h4"/>',
      title: '<path d="M4.6 6.2h9.8M9.5 6.2v13.2M7.2 19.4h4.6"/><path d="M16.4 12.6h4M18.4 12.6v6.8M17.2 19.4h2.4"/>',
      tag: '<path d="M4.2 12.4V5.9a1.7 1.7 0 0 1 1.7-1.7h6.5l7.6 7.6a1.7 1.7 0 0 1 0 2.4l-6.4 6.4a1.7 1.7 0 0 1-2.4 0z"/><circle cx="8.3" cy="8.3" r="1.35"/>',
      plan: '<rect x="3.9" y="5.2" width="16.2" height="15" rx="2.4"/><path d="M3.9 10.2h16.2M8.6 2.9v4.4M15.4 2.9v4.4"/><path d="M7.9 14.1h2M11 14.1h2M14.1 14.1h2M7.9 17.2h2M11 17.2h2"/>',
      due: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.2v5l3.2 1.9"/>',
      chart: '<path d="M4 20V4M4 20h16"/><rect x="7.4" y="12.6" width="3.2" height="4.9" rx="1"/><rect x="12.4" y="8.4" width="3.2" height="9.1" rx="1"/><rect x="17.4" y="10.7" width="3.2" height="6.8" rx="1"/>',
      bolt: '<path d="M13.4 3.2 4.9 13.5h5.9l-.7 7.3 8.5-10.3h-5.9z"/>',
      thumbUp: '<path d="M7.4 10.2v10.2H4.2a.9.9 0 0 1-.9-.9v-8.4a.9.9 0 0 1 .9-.9z"/><path d="M7.4 10.2 11.1 3a2.7 2.7 0 0 1 2.7 2.7v3.6h5.1a1.9 1.9 0 0 1 1.9 2.2l-1.3 7a1.9 1.9 0 0 1-1.9 1.6H7.4"/>',
      thumbDown: '<path d="M16.6 13.8V3.6h3.2a.9.9 0 0 1 .9.9v8.4a.9.9 0 0 1-.9.9z"/><path d="M16.6 13.8 12.9 21a2.7 2.7 0 0 1-2.7-2.7v-3.6H5.1a1.9 1.9 0 0 1-1.9-2.2l1.3-7a1.9 1.9 0 0 1 1.9-1.6h10.2"/>',
      // misc
      recent: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.3V12l3.2 1.9"/>',
      open: '<path d="M13.4 4.6h6v6M19.4 4.6 10.6 13.4"/><path d="M17.8 14v4.4a1.6 1.6 0 0 1-1.6 1.6H5.8a1.6 1.6 0 0 1-1.6-1.6V8a1.6 1.6 0 0 1 1.6-1.6H10"/>',
      filter: '<path d="M3.9 5.6h16.2l-6.3 7.5v5.5l-3.6 1.8v-7.3z"/>',
      sliders: '<path d="M4 7.2h9.4M18.6 7.2h1.5M4 16.8h1.5M10.7 16.8H20"/><circle cx="16" cy="7.2" r="2.5"/><circle cx="8.1" cy="16.8" r="2.5"/>',
      bell: '<path d="M17.6 9.6a5.6 5.6 0 1 0-11.2 0c0 5.2-2.1 6.7-2.1 6.7h15.4s-2.1-1.5-2.1-6.7Z"/><path d="M13.6 19.4a1.9 1.9 0 0 1-3.2 0"/>',
      people: '<circle cx="9.2" cy="8.4" r="3.4"/><path d="M2.9 19.7a6.3 6.3 0 0 1 12.6 0"/><path d="M16.1 5.5a3.4 3.4 0 0 1 0 6.4M17.4 14.2a6.3 6.3 0 0 1 3.7 5.5"/>',
      person: '<circle cx="12" cy="8.2" r="3.7"/><path d="M5.1 20a6.9 6.9 0 0 1 13.8 0"/>',
      trashEmpty: '<path d="M4.4 7.1h15.2M9.7 7.1V4.4h4.6v2.7M6.4 7.1l.85 12.2a1.6 1.6 0 0 0 1.6 1.5h6.3a1.6 1.6 0 0 0 1.6-1.5l.85-12.2"/>',
      keyboard: '<rect x="3.2" y="6.2" width="17.6" height="11.6" rx="2.2"/><path d="M7 10h.01M10.2 10h.01M13.4 10h.01M16.6 10h.01M7.6 14.1h8.8"/>',
      display: '<rect x="3.4" y="4.6" width="17.2" height="11.8" rx="2.2"/><path d="M9.2 20.4h5.6M12 16.4v4"/>',
      install: '<path d="M12 3.6v10.6M7.9 10.1 12 14.2l4.1-4.1M4.8 16.4v2.1a1.5 1.5 0 0 0 1.5 1.5h11.4a1.5 1.5 0 0 0 1.5-1.5v-2.1"/>',
      logout: '<path d="M10.2 17.4 15.6 12l-5.4-5.4M15.2 12H3.9M18.4 4.2h.4a1.7 1.7 0 0 1 1.7 1.7v12.2a1.7 1.7 0 0 1-1.7 1.7h-.4"/>',
      sidebar: '<rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2.3"/><path d="M9.4 4.6v14.8"/>',
      quote: '<path d="M9.6 6.6H6.4a1.9 1.9 0 0 0-1.9 1.9v3.1a1.9 1.9 0 0 0 1.9 1.9h1.5a1.7 1.7 0 0 0 1.7-1.7zM19.5 6.6h-3.2a1.9 1.9 0 0 0-1.9 1.9v3.1a1.9 1.9 0 0 0 1.9 1.9h1.5a1.7 1.7 0 0 0 1.7-1.7z"/><path d="M6.2 13.5c0 2.2-1 3.6-2.6 4.3M16.1 13.5c0 2.2-1 3.6-2.6 4.3"/>',
      wifi: '<path d="M2.9 9.4a13 13 0 0 1 18.2 0M6.2 12.8a8.3 8.3 0 0 1 11.6 0M9.4 16.1a3.7 3.7 0 0 1 5.2 0"/><circle cx="12" cy="19.4" r="1.1" fill="currentColor" stroke="none"/>'
    };
    // Aliases: commands and note kinds ask for these names.
    NZ_ICON_PATHS.text = NZ_ICON_PATHS.note;
    NZ_ICON_PATHS.record = NZ_ICON_PATHS.mic;
    NZ_ICON_PATHS.ask = NZ_ICON_PATHS.search;
    // exam-style question list (used by the assistant's study commands)
    NZ_ICON_PATHS.mcq = '<path d="M4.5 6.5h2M4.5 12h2M4.5 17.5h2M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/>';
    NZ_ICON_PATHS.ai = NZ_ICON_PATHS.spark;
    // A circle with an exclamation: the toast and inline error mark.
    NZ_ICON_PATHS.alert = '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.8v5M12 16.1v.1"/>';
    NZ_ICON_PATHS.export = NZ_ICON_PATHS.upload;
    NZ_ICON_PATHS.import = NZ_ICON_PATHS.download;
    const svgIcon = (name, size = 16, extraClass = '') => `<svg class="icon${extraClass ? ` ${extraClass}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${NZ_ICON_PATHS[name] || NZ_ICON_PATHS.file}</svg>`;
    // Other files build markup too, so the set is shared rather than re-inlined.
    window.nzIcon = svgIcon;
    const esc = (value = '') => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const uid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const wordCount = text => (String(text || '').trim().match(/\b[\w'-]+\b/g) || []).length;
    const timeText = timestamp => {
      const date = new Date(Number(timestamp) || Date.now());
      const elapsed = Math.max(0, Date.now() - date.getTime());
      if (elapsed < 60_000) return 'just now';
      if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))}m ago`;
      if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
      if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };
    const dateText = timestamp => new Date(Number(timestamp) || Date.now()).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    const getExtension = name => (String(name || '').split('.').pop() || '').toLowerCase();
    const fileKind = file => {
      const ext = getExtension(file.name), type = (file.type || '').toLowerCase();
      if (ext === 'md' || ext === 'markdown') return 'markdown';
      if (ext === 'html' || ext === 'htm' || type === 'text/html') return 'html';
      if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
      if (type.startsWith('image/')) return 'image';
      if (type.startsWith('audio/')) return 'audio';
      if (type.startsWith('video/')) return 'video';
      if (type.startsWith('text/') || ['txt','csv','json','xml','yaml','yml','log','py','js','ts','css','java','c','cpp','sh','sql','ini','toml'].includes(ext)) return 'text';
      return 'file';
    };
    const kindLabel = kind => ({ note:'STUDY NOTE', markdown:'MARKDOWN', html:'HTML DOCUMENT', text:'TEXT DOCUMENT', pdf:'PDF DOCUMENT', image:'IMAGE', audio:'AUDIO FILE', video:'VIDEO FILE', file:'ATTACHMENT' })[kind] || 'STUDY NOTE';
    function isPdfNote(note) { return note?.kind === 'pdf' || /application\/(?:x-)?pdf/i.test(String(note?.mimeType || '')) || /\.pdf$/i.test(String(note?.fileName || '')); }
    const formatBytes = bytes => {
      if (!Number.isFinite(bytes) || bytes < 0) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024*1024) return `${(bytes/1024).toFixed(0)} KB`;
      return `${(bytes/1024/1024).toFixed(1)} MB`;
    };
    const normalizeNote = (note, id = '') => ({
      id: String(note?.id || id || uid()),
      title: String(note?.title || 'Untitled note'),
      subject: String(note?.subject || 'General'),
      folderPath: String(note?.folderPath || note?.subject || 'General').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/'),
      tags: Array.isArray(note?.tags) ? note.tags.map(String).slice(0, 15) : [],
      pinned: Boolean(note?.pinned),
      priority: ['high', 'medium', 'low'].includes(note?.priority) ? note.priority : '',
      bookmarks: Array.isArray(note?.bookmarks) ? note.bookmarks.slice(0, 30).map(item => ({ id: String(item?.id || uid()), label: String(item?.label || 'Bookmark').slice(0, 80), pos: Math.max(0, Math.min(1, Number(item?.pos) || 0)), t: Number(item?.t) || 0 })) : [],
      kind: ['note','markdown','html','text','pdf','image','audio','video','file'].includes(note?.kind) ? note.kind : 'note',
      body: String(note?.body || ''),
      bodyPreviewOnly: Boolean(note?.bodyPreviewOnly),
      htmlSource: String(note?.htmlSource || ''),
      htmlReadableText: String(note?.htmlReadableText || ''),
      htmlReadableSourceKey: String(note?.htmlReadableSourceKey || ''),
      fileName: String(note?.fileName || ''),
      mimeType: String(note?.mimeType || ''),
      filePath: String(note?.filePath || ''),
      fileSize: Number(note?.fileSize || 0),
      favorite: Boolean(note?.favorite),
      completed: Boolean(note?.completed),
      reviewDueAt: Number(note?.reviewDueAt || 0),
      reviewIntervalDays: Number(note?.reviewIntervalDays || 0),
      reviewCount: Math.max(0, Number(note?.reviewCount || 0)),
      lastReviewedAt: Number(note?.lastReviewedAt || 0),
      createdAt: Number(note?.createdAt || Date.now()),
      updatedAt: Number(note?.updatedAt || Date.now()),
      lastViewedAt: Number(note?.lastViewedAt || 0)
    });

    function isHtmlSource(value = '') { return /<(?:!doctype\s+html|html|head|body|[a-z][\w:-]*(?:\s|>|\/))/i.test(String(value || '').trim()); }
    function htmlSourceForNote(note) {
      if (!note || note.kind !== 'html') return '';
      return String(note.htmlSource || '') || (!note.bodyPreviewOnly && isHtmlSource(note.body) ? String(note.body) : '');
    }
    function htmlReadableFingerprint(note) {
      return [Number(note?.updatedAt || 0),String(note?.filePath || ''),String(note?.fileName || ''),Number(note?.fileSize || 0),String(note?.htmlSource || '').length,String(note?.body || '').length,'r3'].join('|');
    }
    function cachedReadableHtmlForNote(note) {
      return note?.htmlReadableText && note.htmlReadableSourceKey === htmlReadableFingerprint(note) ? note.htmlReadableText : '';
    }
    // Structure-aware text conversion: keeps lists, tables, headings and accordions readable.
    // Self-contained on purpose: it is also injected into the sandboxed HTML preview.
    function notezReadableWalker(root) {
      const SKIP = new Set(['script','style','noscript','iframe','object','embed','canvas','head','meta','link','base','nav','svg','template']);
      const BLOCK = new Set(['address','article','aside','div','dl','figcaption','footer','form','header','main','section','tbody','thead','tfoot','tr','li','td','th']);
      const BTN = /^(?:dark mode|light mode|print(?:\s*\/\s*save(?:\s+pdf)?)?|save (?:as )?pdf|reload|expand|back to note)$/i;
      const IND = '\u00a0\u00a0';
      const collapse = value => value.replace(/\s+/g, ' ');
      const line = node => collapse(kids(node, 0, false)).trim();
      const kids = (node, depth, pre) => { let out = ''; for (const child of node.childNodes) out += walk(child, depth, pre); return out; };
      function walk(node, depth, pre) {
        if (node.nodeType === 3) return pre ? (node.nodeValue || '') : collapse(node.nodeValue || '');
        if (node.nodeType === 11) return kids(node, depth, pre);
        if (node.nodeType !== 1) return '';
        const tag = node.tagName.toLowerCase(), role = node.getAttribute('role') || '';
        if (SKIP.has(tag) || role === 'tablist' || role === 'navigation' || node.hasAttribute('data-notez-ignore')) return '';
        if (tag === 'input' || tag === 'select' || tag === 'textarea') return '';
        if (tag === 'button' && BTN.test(line(node))) return '';
        if (tag === 'img') return node.getAttribute('alt') || '';
        if (tag === 'br') return '\n';
        if (tag === 'hr') return '\n\n';
        if (/^h[1-6]$/.test(tag)) return '\n\n' + line(node) + '\n\n';
        if (tag === 'pre') return '\n\n' + (node.textContent || '') + '\n\n';
        if (tag === 'table') {
          const rows = [...node.querySelectorAll('tr')].map(row => [...row.children].filter(cell => /^t[dh]$/i.test(cell.tagName)).map(line).join(' | ')).filter(Boolean);
          return '\n\n' + rows.join('\n') + '\n\n';
        }
        if (tag === 'ul' || tag === 'ol') {
          let index = Number(node.getAttribute('start')) || 1, out = '';
          const pad = IND.repeat(depth);
          for (const item of node.children) {
            if (item.tagName.toLowerCase() !== 'li') { out += walk(item, depth, pre); continue; }
            let own = '', nested = '';
            for (const child of item.childNodes) {
              const childTag = child.nodeType === 1 ? child.tagName.toLowerCase() : '';
              if (childTag === 'ul' || childTag === 'ol') nested += walk(child, depth + 1, pre); else own += walk(child, depth, pre);
            }
            out += '\n' + pad + (tag === 'ol' ? (index++) + '. ' : '• ') + collapse(own).trim() + nested;
          }
          return depth ? out : '\n\n' + out + '\n\n';
        }
        if (tag === 'summary') return '\n\n▸ ' + line(node) + '\n';
        if (tag === 'dt') return '\n' + line(node);
        if (tag === 'dd') return '\n' + IND + line(node);
        if (tag === 'blockquote') return '\n\n' + kids(node, depth, pre).trim().split('\n').map(text => '> ' + text.trim()).join('\n') + '\n\n';
        const content = kids(node, depth, pre);
        if (tag === 'p' || tag === 'details' || tag === 'figure') return '\n\n' + content + '\n\n';
        return BLOCK.has(tag) ? '\n' + content + '\n' : content;
      }
      return walk(root, 0, false).replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/(\S)[ \t]{2,}/g, '$1 ').replace(/\n{3,}/g, '\n\n').trim();
    }
    function extractReadableHtml(source = '') {
      try {
        const documentCopy = new DOMParser().parseFromString(String(source || ''), 'text/html');
        return notezReadableWalker(documentCopy.body);
      } catch { return String(source || '').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/\s+/g,' ').trim(); }
    }
    function readableHtmlForNote(note, source = '') {
      if (note?.body && !note.bodyPreviewOnly && !isHtmlSource(note.body)) return note.body;
      const cached = cachedReadableHtmlForNote(note);
      if (cached) return cached;
      const availableSource = source || htmlSourceForNote(note);
      if (availableSource) return extractReadableHtml(availableSource);
      if (note?.body && !isHtmlSource(note.body)) return note.body;
      return extractReadableHtml(note?.body || '');
    }


    const REVIEW_INTERVALS_DAYS = [1,3,7,14,30,60,90];
    const REVIEW_DAY_MS = 86_400_000;
    const NEW_NOTES_PER_DAY = 10;
    function localStudyDay(now = Date.now()) {
      const date = new Date(now);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    }
    function newStudyProgressKey() {
      const scope = currentSession?.mode === 'cloud' ? `cloud-${currentSession.user.uid}` : 'demo';
      return `notez-new-study-progress-v1-${scope}`;
    }
    function readNewStudyIds(now = Date.now()) {
      try {
        const saved = JSON.parse(localStorage.getItem(newStudyProgressKey()) || 'null');
        return saved?.day === localStudyDay(now) && Array.isArray(saved.ids) ? new Set(saved.ids.map(String)) : new Set();
      } catch { return new Set(); }
    }
    function markNewNoteStudiedToday(noteId, now = Date.now()) {
      if (!noteId) return;
      const ids = readNewStudyIds(now);
      ids.add(String(noteId));
      try { localStorage.setItem(newStudyProgressKey(), JSON.stringify({ day:localStudyDay(now), ids:[...ids].slice(0,NEW_NOTES_PER_DAY) })); } catch {}
    }
    function newNotesRemainingToday(now = Date.now()) {
      return Math.max(0, NEW_NOTES_PER_DAY - readNewStudyIds(now).size);
    }
    function reviewState(note, now = Date.now()) {
      if (!note) return 'new';
      const dueAt = Number(note.reviewDueAt) || 0;
      if (dueAt > 0) return dueAt <= now ? 'due' : 'scheduled';
      return note.completed ? 'scheduled' : 'new';
    }
    function isReviewDue(note, now = Date.now()) { return reviewState(note,now) === 'due'; }
    function isNewNote(note, now = Date.now()) { return reviewState(note,now) === 'new'; }
    function reviewDueLabel(note, now = Date.now()) {
      const state = reviewState(note,now);
      if (state === 'new') return 'New';
      if (!Number(note.reviewDueAt)) return 'Reviewed';
      const remaining = Number(note.reviewDueAt) - now;
      if (remaining <= 0) return 'Due now';
      if (remaining < 60 * 60_000) return `in ${Math.max(1, Math.ceil(remaining / 60_000))}m`;
      if (remaining < REVIEW_DAY_MS) return `in ${Math.ceil(remaining / 3_600_000)}h`;
      const days = Math.ceil(remaining / REVIEW_DAY_MS);
      return days === 1 ? 'tomorrow' : `in ${days}d`;
    }
    function scheduleNoteReview(note, rating, now = Date.now()) {
      if (!note) return { intervalDays:0, dueAt:now };
      if (rating === 'reset') {
        note.completed = false;
        note.reviewDueAt = now;
        note.reviewIntervalDays = 0;
        note.updatedAt = now;
        return { intervalDays:0, dueAt:now };
      }
      let intervalDays = 1;
      const stage = Math.max(0, Math.floor(Number(note.reviewCount) || 0));
      const previousInterval = Math.max(0, Number(note.reviewIntervalDays) || 0);
      if (rating === 'again') {
        intervalDays = 10 / 1440;
        note.reviewCount = 0;
      } else if (rating === 'hard') {
        const harder = Math.max(1, previousInterval * 1.2, previousInterval + 1);
        intervalDays = Math.min(90, Math.ceil(harder * 10) / 10);
        note.reviewCount = Math.min(stage + 1, REVIEW_INTERVALS_DAYS.length - 1);
      } else if (rating === 'easy') {
        const nextStage = Math.min(stage + 1, REVIEW_INTERVALS_DAYS.length - 1);
        intervalDays = Math.max(previousInterval, REVIEW_INTERVALS_DAYS[nextStage]);
        note.reviewCount = Math.min(nextStage + 1, REVIEW_INTERVALS_DAYS.length - 1);
      } else {
        intervalDays = Math.max(previousInterval, REVIEW_INTERVALS_DAYS[Math.min(stage, REVIEW_INTERVALS_DAYS.length - 1)]);
        note.reviewCount = Math.min(stage + 1, REVIEW_INTERVALS_DAYS.length - 1);
      }
      note.completed = true;
      note.reviewIntervalDays = intervalDays;
      note.lastReviewedAt = now;
      note.reviewDueAt = now + intervalDays * REVIEW_DAY_MS;
      note.updatedAt = now;
      return { intervalDays, dueAt:note.reviewDueAt };
    }
    function updateReviewControl(note) {
      if (!note) return;
      const button = $('#complete-current');
      const state = reviewState(note);
      const due = state === 'due';
      button.classList.toggle('completed', note.completed && !due);
      button.classList.toggle('review-due', due);
      button.classList.toggle('review-new', state === 'new');
      button.title = due ? 'Choose how well you recalled this note and schedule its next review.' : state === 'new' ? 'This is a new note. Rate your recall to begin its spaced-review schedule.' : note.reviewDueAt ? `Next review ${reviewDueLabel(note)}. Choose to practice now or return to the queue.` : 'Reviewed · not yet on a spaced schedule. Choose to practice now or return to the queue.';
      button.setAttribute('aria-label', button.title);
      button.querySelector('.reader-tool-label').textContent = due ? 'Review' : state === 'new' ? 'New' : reviewDueLabel(note);
      updateReviewPopover(note);
    }
    function markdownToHtml(markdown) {
      // Use the safe renderer if available, otherwise fall back to basic
      if (typeof window.markdownToHtmlSafe === 'function') {
        return window.markdownToHtmlSafe(markdown);
      }
      const inline = source => {
        let text = source;  // Do NOT escape here - escape matched content in replacements
        text = text.replace(/`([^`]+)`/g, (_, inner) => `<code>${esc(inner)}</code>`);
        text = text.replace(/\[\[([^\]]+)\]\]/g, (_, title) => `<a href="#" class="nz-wiki" data-wiki="${esc(title.trim())}">${esc(title.trim())}</a>`);
        text = text.replace(/\*\*([^*]+)\*\*/g, (_, inner) => `<strong>${esc(inner)}</strong>`).replace(/__([^_]+)__/g, (_, inner) => `<strong>${esc(inner)}</strong>`);
        text = text.replace(/(^|[^*])\*([^*]+)\*/g, (_, prefix, inner) => `${prefix}<em>${esc(inner)}</em>`);
        text = text.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (match, linkText, url) => {
          return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(linkText)}</a>`;
        });
        return text;
      };
      const output = [];
      let paragraph = [], listType = '', code = false, codeLines = [], quoteLines = [];
      const closeList = () => { if (listType) { output.push(`</${listType}>`); listType = ''; } };
      const flushParagraph = () => { if (paragraph.length) { output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph = []; } };
      const flushQuote = () => { if (quoteLines.length) { output.push(`<blockquote>${quoteLines.map(line => `<p>${inline(line)}</p>`).join('')}</blockquote>`); quoteLines = []; } };
      for (const line of lines) {
        if (/^\s*```/.test(line)) {
          flushParagraph(); closeList(); flushQuote();
          if (code) { output.push(`<pre><code>${esc(codeLines.join('\n'))}</code></pre>`); codeLines = []; code = false; }
          else code = true;
          continue;
        }
        if (code) { codeLines.push(line); continue; }
        if (!line.trim()) { flushParagraph(); closeList(); flushQuote(); continue; }
        const heading = line.match(/^\s{0,3}(#{1,4})\s+(.+)$/);
        if (heading) { flushParagraph(); closeList(); flushQuote(); const level = Math.min(4, heading[1].length); output.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
        if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { flushParagraph(); closeList(); flushQuote(); output.push('<hr>'); continue; }
        if (/^\s*>/.test(line)) { flushParagraph(); closeList(); quoteLines.push(line.replace(/^\s*>\s?/, '')); continue; }
        const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
        const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (bullet || numbered) {
          flushParagraph(); flushQuote();
          const nextType = bullet ? 'ul' : 'ol';
          if (listType && listType !== nextType) closeList();
          if (!listType) { listType = nextType; output.push(`<${listType}>`); }
          const rawItem = (bullet || numbered)[1];
          const check = rawItem.match(/^\[([ xX])\]\s+(.*)$/);
          const TICK = '<path d="M4.6 7.1h8.8M4.6 12h8.8M4.6 16.9h5.4"/><path d="m15.4 15.9 1.7 1.8 3.2-4"/>';
          const BOX = '<path d="M4.6 7.1h8.8M4.6 12h8.8M4.6 16.9h5.4"/><rect x="15" y="14.6" width="5.2" height="5.2" rx="1.2"/>';
          const tick = (name) => `<svg class="icon md-task" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${name}</svg>`;
          output.push(`<li>${check ? `<span class="md-task-slot" aria-label="${check[1].trim() ? 'complete' : 'incomplete'}">${tick(check[1].trim() ? TICK : BOX)}</span> ${inline(check[2])}` : inline(rawItem)}</li>`);
          continue;
        }
        closeList(); flushQuote(); paragraph.push(line.trim());
      }
      if (code) output.push(`<pre><code>${esc(codeLines.join('\n'))}</code></pre>`);
      flushParagraph(); closeList(); flushQuote();
      return output.join('\n') || '<p class="subtle">There is no content in this note yet. Select <strong>Edit</strong> to add your first thought.</p>';
    }

    let currentSession = null;
    let userChoseDemo = false;
    let notes = [];
    let activeId = '';
    let studySession = null;
    let reviewDueSignature = '';
    let activeFilter = 'all';
    let prioFilter = '';
    let currentPage = 'home';
    let previousPage = 'home';
    let editorReturnPage = 'home';
    let currentFolderPath = '';
    let routeIndex = 0;
    let contextTarget = null;
    let accountMenuTrigger = null;
    let commandReturnFocus = null;
    let commandEntries = [];
    let commandActiveIndex = 0;
    let folders = [];
    let expandedFolders = new Set();
    let folderTreeInitialized = false;
    let loginMode = 'signin';
    let editorId = '';
    let editingNew = false;
    let editorKind = 'note';
    let activeObjectUrl = '';
    let dbSdk = null;
    let pdfJsPromise = null;
    let activePdfReaderState = null;
    let cloudSyncPromise = null;
    let syncIntervalId = 0;
    let reviewClockId = 0;
    let lastSyncAt = 0;
    let editorPreviewMode = false;
    let editorDraftTimer = 0;
    let cloudDraftTimer = 0;
    let lastCloudDraftSignature = '';
    let searchRenderTimer = 0;
    let readingProgressFrame = 0;
    const MAX_IMPORT_FILE_BYTES = 150 * 1024 * 1024;
    const CLOUD_SYNC_INTERVAL = 30000;
    let firebasePromise = null;
    let authListenerStarted = false;
    let sortMode = 'newest';
    try { sortMode = ['newest','oldest','title'].includes(localStorage.getItem('notez-sort-mode-v1')) ? localStorage.getItem('notez-sort-mode-v1') : 'newest'; } catch {}
    let libraryView = 'grid';
    let sidebarCollapsed = false;
    try { sidebarCollapsed = localStorage.getItem('notez-sidebar-collapsed-v1') === '1'; } catch {}
    let selectionMode = false;
    const selectedNoteIds = new Set();
    try { libraryView = localStorage.getItem('notez-library-view-v1') === 'list' ? 'list' : 'grid'; } catch {}
    const localFileMemory = new Map();
    const objectUrlCache = new Map();
    const htmlReadableFrames = new WeakMap();
    let htmlEditorSeedText = '';
    let htmlEditorMayHydrate = false;
    let readerPositionTimer = 0;
    let readerPositionRestorePendingId = '';
    let readerRenderedId = '';
    let readerRenderKey = '';
    let lastNotesSignature = '';
    const readerKeyOf = note => note ? [note.id, note.updatedAt, note.title, note.body ? note.body.length : 0, note.filePath || '', note.fileName || '', note.kind, note.htmlSource ? note.htmlSource.length : 0].join('|') : '';
    const notesSignatureOf = list => list.map(note => [note.id, note.updatedAt, note.folderPath || '', note.favorite ? 1 : 0, note.title].join('~')).join('|');
    let toastTimer = null;
    let dragDepth = 0;
    const DB_NAME = 'notez-local-v1';
    const DB_STORE = 'attachments';
    const LOCAL_ATTACHMENT_INDEX_KEY = 'notez-local-attachment-index-v1';
    let localAttachmentIds = new Set();
    try {
      const savedIds = JSON.parse(localStorage.getItem(LOCAL_ATTACHMENT_INDEX_KEY) || '[]');
      if (Array.isArray(savedIds)) localAttachmentIds = new Set(savedIds.map(String));
    } catch {}
    function persistLocalAttachmentIndex() {
      try { localStorage.setItem(LOCAL_ATTACHMENT_INDEX_KEY, JSON.stringify([...localAttachmentIds])); } catch {}
    }
    function compactNotesForMirror(records) {
      return records.map(item => {
        const note = normalizeNote(item);
        note.htmlReadableText = '';
        note.htmlReadableSourceKey = '';
        if (note.kind === 'html' && note.htmlSource.length > 32_000 && localAttachmentIds.has(note.id)) note.htmlSource = '';
        return note;
      });
    }
    function writeNotesMirror(key, records, failureMessage) {
      try { localStorage.setItem(key, JSON.stringify(records.map(item => normalizeNote(item)))); return true; }
      catch (error) {
        console.warn('Full local note mirror did not fit; retrying with compact HTML caches:', error);
        try {
          localStorage.setItem(key, JSON.stringify(compactNotesForMirror(records)));
          toast('Browser storage is tight. Rebuildable HTML caches were cleared; your stored originals are kept.', 'success', 5200);
          return true;
        } catch (compactError) {
          console.warn('Could not write compact local note mirror:', compactError);
          toast(failureMessage, 'error', 6000);
          return false;
        }
      }
    }

    function toast(message, type = 'success', duration = 3600) {
      const item = document.createElement('div');
      item.className = `toast ${type === 'error' ? 'error' : ''}`;
      item.innerHTML = `<span class="toast-mark">${svgIcon(type === 'error' ? 'alert' : 'check', 15)}</span><span>${esc(message)}</span>`;
      $('#toast-stack').append(item);
      window.setTimeout(() => item.remove(), duration);
    }
    function showAuthError(message) {
      const box = $('#auth-error');
      box.textContent = message;
      box.classList.add('show');
      $('#auth-status').textContent = '';
      $('#auth-status').classList.remove('show');
    }
    function showAuthStatus(message) {
      const box = $('#auth-status');
      box.textContent = message;
      box.classList.add('show');
      $('#auth-error').textContent = '';
      $('#auth-error').classList.remove('show');
    }
    function clearAuthError() {
      $('#auth-error').textContent = '';
      $('#auth-error').classList.remove('show');
      $('#auth-status').textContent = '';
      $('#auth-status').classList.remove('show');
    }
    // A provider's own refusal ("credential rejected", "(tried groq, mistral)",
    // a raw upstream body) is never shown to the user. Anything that looks like
    // infrastructure noise becomes one plain sentence; the detail is logged.
    function nzSafeError(error, fallback = 'The AI is busy right now. Try again in a moment.') {
      const raw = String(error?.message || error || '').replace(/\s*\(tried[^)]*\)/gi, '').trim();
      if (!raw) return fallback;
      if (/credential|api[ _-]?key|unauthori[sz]ed|forbidden|quota|rate.?limit|resource[ _-]?exhausted|overload|temporarily|unavailable|internal server|bad gateway|gateway timeout|\b(401|403|408|429|5\d\d)\b|model.{0,24}(not|unsup|decommiss|retir)|decommiss|unsupported provider|no credential/i.test(raw)) {
        console.warn('AI detail (not shown to the user):', error);
        return fallback;
      }
      return raw;
    }
    window.nzSafeError = nzSafeError;

    function friendlyFirebaseError(error) {
      const code = String(error?.code || '').toLowerCase();
      if (code.includes('api-key-not-valid')) return 'Firebase rejected the web API key. Recopy apiKey from Firebase Console → Project settings → General → Your apps for this same project, and check that the Google Cloud key is active and not restricted away from Firebase Authentication. If the key is valid but sign-in still fails, add this app’s hostname under Authentication → Settings → Authorized domains.';
      const messages = {
        'auth/invalid-email': 'That email address does not look valid.',
        'auth/user-not-found': 'No account was found for that email. Create an account to get started.',
        'auth/wrong-password': 'That password is incorrect. Try again or reset it.',
        'auth/invalid-credential': 'Email or password is incorrect. Check your details and try again.',
        'auth/email-already-in-use': 'An account already exists with this email. Try signing in instead.',
        'auth/weak-password': 'Choose a password with at least 6 characters.',
        'auth/too-many-requests': 'Too many attempts. Wait a moment, then try again.',
        'auth/network-request-failed': 'Could not reach Firebase. Check your internet connection.',
        'auth/operation-not-allowed': 'Email/password sign-in is not enabled in Firebase Authentication yet.',
        'auth/unauthorized-continue-uri': 'Firebase rejected the reset link domain. Add this app domain to Authentication’s authorized domains.',
        'auth/invalid-continue-uri': 'The password-reset link is not configured correctly in Firebase Authentication.'
      };
      Object.assign(messages, {
        'auth/invalid-api-key': 'The Firebase API key is invalid. Copy apiKey again from Firebase Console → Project settings → Your apps.',
        'auth/configuration-not-found': 'Authentication is not set up for this project. In Firebase Console open Authentication → Get started, then enable Email/Password under Sign-in method.',
        'auth/unauthorized-domain': 'This domain is not authorized. Add exactly "' + location.hostname + '" under Authentication → Settings → Authorized domains (subdomains are not covered automatically).',
        'auth/web-storage-unsupported': 'This browser is blocking storage (private mode or an in-app browser). Open the site in Chrome or Safari normally.',
        'auth/internal-error': 'Firebase returned an internal error. This is usually an API-key restriction: in Google Cloud Console → APIs & Services → Credentials, make sure the browser key allows "' + location.origin + '/*" and the Identity Toolkit API.',
        'auth/user-disabled': 'This account has been disabled.',
        'auth/missing-password': 'Enter your password.'
      });
      const raw = String(error?.message || '');
      if (/referer|referrer/i.test(raw) && /blocked/i.test(raw)) return 'Google Cloud is blocking requests from "' + location.origin + '". Open Google Cloud Console → APIs & Services → Credentials → your Browser key → Website restrictions, and add ' + location.origin + '/* (also allow Identity Toolkit API under API restrictions).';
      const base = messages[code] || error?.message || 'Something went wrong. Please try again.';
      return code ? base + ' [' + code + ']' : base;
    }

    function themeSvg(name) {
      return name === 'dark'
        ? '<svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.7 8.7 0 1 0 20.2 15.1Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg class="icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6"/><path d="M12 2.5v2m0 15v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2.5 12h2m15 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    }
    function applyTheme(theme, save = true) {
      const selected = theme === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', selected);
      const themeMeta = $('meta[name="theme-color"]');
      if (themeMeta) themeMeta.content = selected === 'light' ? '#f3f6f8' : '#080e18';
      if (save) { try { localStorage.setItem('notez-theme-v1', selected); } catch {} }
      const switchTo = selected === 'dark' ? 'light' : 'dark';
      $$('.theme-toggle').forEach(button => {
        button.innerHTML = themeSvg(switchTo);
        button.setAttribute('aria-label', `Switch to ${switchTo} appearance`);
        button.title = `Switch to ${switchTo} appearance`;
      });
    }
    async function toggleTheme() {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next, true);
      if (currentSession?.mode === 'cloud') {
        try {
          const sdk = await ensureFirebase();
          await sdk.dbSet(sdk.dbRef(sdk.database, `users/${currentSession.user.uid}/settings/theme`), next);
        } catch (error) { console.warn('Theme saved locally; cloud preference could not sync:', error); }
      }
    }
    function ensureFirebase() {
      if (dbSdk) return Promise.resolve(dbSdk);
      if (!firebasePromise) {
        firebasePromise = Promise.all([
          import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
          import('https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js')
        ]).then(([appModule, authModule, databaseModule]) => {
          // Never silently reuse a default Firebase app configured for a different project.
          const matchingApp = appModule.getApps().find(candidate => Object.entries(firebaseConfig).every(([key,value]) => candidate.options?.[key] === value));
          let app = matchingApp;
          if (!app) {
            const baseName = `notez-${firebaseConfig.projectId}`;
            let appName = baseName, suffix = 1;
            while (appModule.getApps().some(candidate => candidate.name === appName)) appName = `${baseName}-${suffix++}`;
            app = appModule.initializeApp(firebaseConfig, appName);
          }
          dbSdk = {
            auth: (() => {
              try {
                return authModule.initializeAuth(app, { persistence: [authModule.indexedDBLocalPersistence, authModule.browserLocalPersistence, authModule.browserSessionPersistence, authModule.inMemoryPersistence], popupRedirectResolver: authModule.browserPopupRedirectResolver });
              } catch (e) { return authModule.getAuth(app); }
            })(),
            onAuthStateChanged: authModule.onAuthStateChanged,
            signInAnonymously: authModule.signInAnonymously,
            guestAuth: (() => {
              // Separate app + auth so anonymous AI tokens never trigger the main workspace auth listener.
              try {
                const guestApp = appModule.getApps().find(candidate => candidate.name === 'notez-ai-guest') || appModule.initializeApp(firebaseConfig, 'notez-ai-guest');
                try { return authModule.initializeAuth(guestApp, { persistence: [authModule.indexedDBLocalPersistence, authModule.browserLocalPersistence] }); }
                catch { return authModule.getAuth(guestApp); }
              } catch { return null; }
            })(),
            inMemoryPersistence: authModule.inMemoryPersistence,
            GoogleAuthProvider: authModule.GoogleAuthProvider,
            signInWithPopup: authModule.signInWithPopup,
            sendEmailVerification: authModule.sendEmailVerification,
            deleteUser: authModule.deleteUser,
            signInWithEmailAndPassword: authModule.signInWithEmailAndPassword,
            createUserWithEmailAndPassword: authModule.createUserWithEmailAndPassword,
            sendPasswordResetEmail: authModule.sendPasswordResetEmail,
            setPersistence: authModule.setPersistence,
            browserLocalPersistence: authModule.browserLocalPersistence,
            browserSessionPersistence: authModule.browserSessionPersistence,
            signOut: authModule.signOut,
            database: databaseModule.getDatabase(app),
            dbRef: databaseModule.ref,
            dbGet: databaseModule.get,
            dbSet: databaseModule.set,
            dbRemove: databaseModule.remove
          };
          if (!authListenerStarted) {
            authListenerStarted = true;
            dbSdk.onAuthStateChanged(dbSdk.auth, user => {
              try { if (user) localStorage.setItem('notez-auth-hint', '1'); else localStorage.removeItem('notez-auth-hint'); } catch {}
              if (!user) window.nzAuthNoUser = true;
              if (user && !userChoseDemo) enterCloudWorkspace(user);
              else if (!user && currentSession?.mode === 'cloud') leaveWorkspace(false);
            });
          }
          return dbSdk;
        }).catch(error => { firebasePromise = null; throw error; });
      }
      return firebasePromise;
    }

    function openLocalDb() {
      return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE, { keyPath: 'id' }); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open local file storage'));
      });
    }
    async function storeLocalFile(id, file) {
      localFileMemory.set(id, file);
      try {
        const db = await openLocalDb();
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(DB_STORE, 'readwrite');
          transaction.objectStore(DB_STORE).put({ id, blob: file, name: file.name, type: file.type, size: file.size });
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('Storage aborted'));
        });
        db.close();
        localAttachmentIds.add(String(id));
        persistLocalAttachmentIndex();
        return true;
      } catch (error) { console.warn('Local attachment persistence unavailable:', error); return false; }
    }
    async function getLocalFile(id) {
      if (localFileMemory.has(id)) return localFileMemory.get(id);
      try {
        const db = await openLocalDb();
        const value = await new Promise((resolve, reject) => {
          const transaction = db.transaction(DB_STORE, 'readonly');
          const request = transaction.objectStore(DB_STORE).get(id);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        });
        db.close();
        if (value?.blob) { localAttachmentIds.add(String(id)); persistLocalAttachmentIndex(); return value.blob; }
        localAttachmentIds.delete(String(id)); persistLocalAttachmentIndex();
        return null;
      } catch { return null; }
    }
    async function removeLocalFile(id) {
      localFileMemory.delete(id);
      localAttachmentIds.delete(String(id));
      persistLocalAttachmentIndex();
      try {
        const db = await openLocalDb();
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(DB_STORE, 'readwrite');
          transaction.objectStore(DB_STORE).delete(id);
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
        db.close();
      } catch { /* demo can continue without IndexedDB */ }
    }

    function localNotesRead() {
      try {
        const raw = localStorage.getItem('notez-demo-notes-v1');
        return raw ? JSON.parse(raw).map(item => normalizeNote(item)) : null;
      } catch { return null; }
    }
    function localNotesWrite() {
      return writeNotesMirror('notez-demo-notes-v1', notes, 'This browser could not save more demo data. Export or remove a few notes to free space.');
    }
    const cloudCacheKey = uidValue => `notez-cloud-cache-v2-${uidValue}`;
    const cloudPendingKey = uidValue => `notez-cloud-pending-v2-${uidValue}`;
    const cloudDeletedKey = uidValue => `notez-cloud-deleted-v2-${uidValue}`;
    const cloudSyncTimeKey = uidValue => `notez-cloud-sync-time-v2-${uidValue}`;
    const cloudFoldersKey = uidValue => `notez-cloud-folders-v1-${uidValue}`;
    const cloudFoldersPendingKey = uidValue => `notez-cloud-folders-pending-v1-${uidValue}`;
    function cleanFolderPath(value) { return String(value || '').replace(/\\/g, '/').split('/').map(part => part.trim()).filter(Boolean).join('/').slice(0, 160); }
    function normalizeFolderList(values = []) {
      const result = new Set();
      const entries = Array.isArray(values) ? values : Object.values(values || {});
      for (const raw of entries) {
        const parts = cleanFolderPath(raw).split('/').filter(Boolean);
        let current = '';
        for (const part of parts) { current = current ? `${current}/${part}` : part; result.add(current); }
      }
      return [...result].sort((a,b) => a.localeCompare(b));
    }
    function readDemoFolders() {
      try { return normalizeFolderList(JSON.parse(localStorage.getItem('notez-demo-folders-v1') || '[]')); } catch { return []; }
    }
    function writeDemoFolders() { try { localStorage.setItem('notez-demo-folders-v1', JSON.stringify(folders)); } catch {} }
    function readCloudFolders(uidValue) {
      try { return normalizeFolderList(JSON.parse(localStorage.getItem(cloudFoldersKey(uidValue)) || '[]')); } catch { return []; }
    }
    function writeCloudFolders(uidValue, values = folders, pending = false) {
      folders = normalizeFolderList(values);
      try {
        localStorage.setItem(cloudFoldersKey(uidValue), JSON.stringify(folders));
        localStorage.setItem(cloudFoldersPendingKey(uidValue), pending ? '1' : '0');
      } catch (error) { console.warn('Could not cache folder list:', error); }
    }
    function persistFolderList() {
      folders = normalizeFolderList(folders);
      if (currentSession?.mode === 'demo') { writeDemoFolders(); return; }
      if (currentSession?.mode === 'cloud') {
        const uidValue = currentSession.user.uid;
        writeCloudFolders(uidValue, folders, true);
        if (navigator.onLine) flushCloudFolders(uidValue).catch(error => { console.warn(error); setSyncState('pending'); });
      }
    }
    async function flushCloudFolders(uidValue = currentSession?.user?.uid, sdk = null) {
      if (!uidValue || currentSession?.mode !== 'cloud' || currentSession.user.uid !== uidValue || !navigator.onLine) return;
      const firebase = sdk || await ensureFirebase();
      const path = `users/${uidValue}/settings/folders`;
      const pending = localStorage.getItem(cloudFoldersPendingKey(uidValue)) === '1';
      const snapshot = await firebase.dbGet(firebase.dbRef(firebase.database, path));
      const tombPath = `users/${uidValue}/settings/folderTombs`;
      const tombSnap = await firebase.dbGet(firebase.dbRef(firebase.database, tombPath));
      const remoteTombs = {};
      if (tombSnap.exists()) for (const [key, value] of Object.entries(tombSnap.val() || {})) remoteTombs[decodeTombKey(key)] = value;
      const tombs = mergeTombs(readFolderTombs(uidValue), remoteTombs);
      writeFolderTombs(uidValue, tombs);
      if (JSON.stringify(tombs) !== JSON.stringify(remoteTombs)) {
        await firebase.dbSet(firebase.dbRef(firebase.database, tombPath), Object.fromEntries(Object.entries(tombs).map(([key, value]) => [encodeTombKey(key), value])));
      }
      if (pending || !snapshot.exists()) {
        const remoteFolders = snapshot.exists() ? normalizeFolderList(snapshot.val()) : [];
        folders = normalizeFolderList([...remoteFolders, ...folders].filter(item => !folderIsDead(item, tombs)));
        if (folders.length || pending) await firebase.dbSet(firebase.dbRef(firebase.database, path), folders);
        writeCloudFolders(uidValue, folders, false);
      } else {
        folders = normalizeFolderList(snapshot.val()).filter(item => !folderIsDead(item, tombs));
        writeCloudFolders(uidValue, folders, false);
      }
      renderFolderTree();
    }
    // ---- Folder deletions are recorded as tombstones so cloud merges cannot bring them back ----
    const folderTombKey = uidValue => `notez-folder-tombs-v2-${uidValue}`;
    const tombUid = () => currentSession?.mode === 'cloud' ? currentSession.user.uid : '';
    function readFolderTombs(uidValue = tombUid()) {
      if (!uidValue) return {};
      try { return JSON.parse(localStorage.getItem(folderTombKey(uidValue))) || {}; } catch { return {}; }
    }
    function writeFolderTombs(uidValue, map) { try { localStorage.setItem(folderTombKey(uidValue), JSON.stringify(map)); } catch {} }
    const encodeTombKey = value => encodeURIComponent(value).replace(/\./g, '%2E');
    const decodeTombKey = value => decodeURIComponent(value);
    function mergeTombs(a, b) {
      const out = { ...a };
      for (const [key, value] of Object.entries(b || {})) if (!out[key] || (value.t || 0) > (out[key].t || 0)) out[key] = value;
      return out;
    }
    function folderIsDead(path, map) {
      const parts = String(path || '').split('/');
      for (let i = 1; i <= parts.length; i++) if (map[parts.slice(0, i).join('/')]?.dead) return true;
      return false;
    }
    function markFolderDeleted(paths) {
      const uidValue = tombUid(); if (!uidValue) return;
      const map = readFolderTombs(uidValue), now = Date.now();
      paths.forEach(path => { map[path] = { t: now, dead: true }; });
      writeFolderTombs(uidValue, map);
    }
    function revivePath(path) {
      const uidValue = tombUid(); if (!uidValue) return false;
      const map = readFolderTombs(uidValue), parts = path.split('/'); let changed = false; const now = Date.now();
      for (let i = 1; i <= parts.length; i++) {
        const key = parts.slice(0, i).join('/');
        if (map[key]?.dead) { map[key] = { t: now, dead: false }; changed = true; }
      }
      if (changed) writeFolderTombs(uidValue, map);
      return changed;
    }
    function addFolderPath(path) {
      const cleaned = cleanFolderPath(path);
      if (!cleaned) return false;
      revivePath(cleaned);
      folders = normalizeFolderList([...folders, cleaned]);
      persistFolderList();
      renderFolderTree();
      return true;
    }
    function expandFolderPath(path) {
      // Sub folders stay collapsed in the sidebar until the user presses that folder's toggle.
    }
    function getAllFolderPaths() {
      const map = readFolderTombs();
      return normalizeFolderList([...folders, ...notes.map(note => note.folderPath)]).filter(path => !folderIsDead(path, map));
    }
    function readCloudCache(uidValue) {
      try {
        const raw = localStorage.getItem(cloudCacheKey(uidValue));
        return raw ? JSON.parse(raw).map(item => normalizeNote(item)) : [];
      } catch { return []; }
    }
    function writeCloudCache(uidValue, records = notes) {
      return writeNotesMirror(cloudCacheKey(uidValue), records, 'Browser cache is full. Your Firebase copy remains primary, but some local changes may not be mirrored.');
    }
    function readPendingIds(uidValue) {
      try { const value = JSON.parse(localStorage.getItem(cloudPendingKey(uidValue)) || '[]'); return Array.isArray(value) ? value.map(String) : []; }
      catch { return []; }
    }
    function markPending(uidValue, id, pending = true) {
      const ids = new Set(readPendingIds(uidValue));
      if (pending) ids.add(String(id)); else ids.delete(String(id));
      try { localStorage.setItem(cloudPendingKey(uidValue), JSON.stringify([...ids])); } catch {}
    }
    function readCloudDeletions(uidValue) {
      try { return JSON.parse(localStorage.getItem(cloudDeletedKey(uidValue)) || '{}') || {}; } catch { return {}; }
    }
    function setCloudDeletion(uidValue, id, tombstone = null) {
      const deletions = readCloudDeletions(uidValue);
      if (tombstone) deletions[id] = tombstone; else delete deletions[id];
      try { localStorage.setItem(cloudDeletedKey(uidValue), JSON.stringify(deletions)); } catch {}
    }
    function hasPendingCloudChanges(uidValue = currentSession?.user?.uid) {
      return Boolean(uidValue && (readPendingIds(uidValue).length || Object.keys(readCloudDeletions(uidValue)).length || localStorage.getItem(cloudFoldersPendingKey(uidValue)) === '1'));
    }
    function updateCachedCloudNote(note, pending = true) {
      if (!currentSession?.user?.uid) return;
      const uidValue = currentSession.user.uid;
      const next = [normalizeNote(note), ...notes.filter(item => item.id !== note.id)];
      writeCloudCache(uidValue, next);
      markPending(uidValue, note.id, pending);
    }
    function readLastSync(uidValue) {
      try { return Number(localStorage.getItem(cloudSyncTimeKey(uidValue)) || 0); } catch { return 0; }
    }
    function seedDemoNotes() {
      const now = Date.now();
      return [
        normalizeNote({ id: uid(), title: 'How memory becomes knowledge', subject: 'Learning Science', tags: ['revision','learning'], kind: 'markdown', favorite: true, createdAt: now - 86400000 * 5, updatedAt: now - 3600000 * 3, lastViewedAt: now - 3600000, body: `A useful way to think about learning is as a process of **building durable connections**, not collecting pages of information.\n\n## The three stages\n\n1. **Encode** — connect new information to something you already understand.\n2. **Consolidate** — let the idea settle; sleep and time help stabilize it.\n3. **Retrieve** — practice bringing the idea back without looking.\n\n> Retrieval is not just a test of learning. It is one of the ways learning happens.\n\n## Make a study session count\n\n- Start with a question, not a highlighter.\n- Explain the idea in your own words.\n- Return to it after a delay: 1 day, 3 days, then a week.\n- Notice what you cannot recall; that is your next study target.\n\n### A small check\n\nClose the page and write the three stages from memory. Then compare your answer and fill only the gaps.\n\n---\n\n**Takeaway:** effortful recall with spaced repetition is more reliable than rereading alone.` }),
        normalizeNote({ id: uid(), title: 'Cellular respiration — core map', subject: 'Biology', tags: ['cell biology','exam prep'], kind: 'markdown', favorite: false, createdAt: now - 86400000 * 3, updatedAt: now - 86400000, body: `## Big picture\n\nCells transfer energy from glucose into **ATP**, the usable energy currency for cellular work. In aerobic respiration, oxygen is the final electron acceptor.\n\n### The pathway\n\n1. **Glycolysis** · cytoplasm · glucose becomes two pyruvate molecules.\n2. **Citric acid cycle** · mitochondrial matrix · carbon is released as carbon dioxide; electron carriers are loaded.\n3. **Oxidative phosphorylation** · inner mitochondrial membrane · the electron transport chain builds a proton gradient that drives ATP synthase.\n\n> Oxygen does not directly make ATP. It accepts electrons at the end of the chain, allowing electron flow to continue.\n\n## Self-check\n\n- Where does glycolysis happen?\n- What powers ATP synthase?\n- Why does the chain slow when oxygen is unavailable?` }),
        normalizeNote({ id: uid(), title: 'Vectors: intuition before notation', subject: 'Mathematics', tags: ['linear algebra'], kind: 'markdown', favorite: false, createdAt: now - 86400000 * 2, updatedAt: now - 86400000 * 2, body: `A vector is an object with **magnitude and direction**. In a coordinate system, we describe it with components, but its meaning does not depend on the coordinate labels.\n\n## Add by combining movement\n\nIf you walk 3 units east and then 2 units north, the total displacement is the diagonal from your starting point to your finish. Component-wise: \`(3, 0) + (0, 2) = (3, 2)\`.\n\n### Dot product\n\nThe dot product measures how much two vectors point in the same direction.\n\n- A positive result: broadly aligned.\n- Zero: perpendicular.\n- A negative result: broadly opposed.\n\n> Think of projection: how much of one arrow lies along the other?\n\n**Try it:** sketch two vectors, then predict the sign of their dot product before calculating.` }),
        normalizeNote({ id: uid(), title: 'A better research question', subject: 'Research Methods', tags: ['writing','planning'], kind: 'text', favorite: false, createdAt: now - 86400000, updatedAt: now - 86400000 * 0.5, body: `A strong research question is specific enough to investigate and open enough to require reasoning.\n\nWeak: “Is social media bad?”\n\nStronger: “How does daily short-form video use relate to sleep duration among first-year university students?”\n\nA useful first draft names the population, the relationship or phenomenon, and a workable context. Then check: Can evidence answer it? Is the scope realistic? Does the wording avoid assuming the conclusion?\n\nNext step: choose one measurable term and define it before searching for sources.` })
      ];
    }

    function showApp() {
      $('#login-screen').classList.add('hidden');
      $('#app-shell').classList.remove('hidden');
      closeAccountMenu();
      closeActionMenu(); closeSortMenu();
      document.body.style.overflow = 'hidden';
    }
    function showLogin() {
      $('#app-shell').classList.add('hidden');
      $('#login-screen').classList.remove('hidden');
      document.body.style.overflow = '';
    }
    function enterDemoWorkspace() {
      userChoseDemo = true;
      selectionMode = false; selectedNoteIds.clear();
      currentSession = { mode: 'demo', name: 'Demo space', email: '' };
      const saved = localNotesRead();
      notes = saved || seedDemoNotes();
      if (!saved) localNotesWrite();
      folders = readDemoFolders();
      activeId = '';
      activeFilter = 'all';
      currentPage = 'home'; previousPage = 'home'; editorReturnPage = 'home'; editorId = ''; editingNew = false; editorKind = 'note';
      currentFolderPath = '';
      $('#search-input').value = '';
      folderTreeInitialized = false;
      expandedFolders = new Set();
      replaceAppRoute();
      showApp();
      updateAccountUi();
      renderEverything();
      toast('Demo workspace ready. Your notes stay in this browser.');
    }
    async function enterCloudWorkspace(user) {
      if (!user) return;
      if (currentSession?.mode === 'cloud' && currentSession.user?.uid === user.uid && !$('#app-shell').classList.contains('hidden')) return;
      userChoseDemo = false;
      selectionMode = false; selectedNoteIds.clear();
      currentSession = { mode: 'cloud', user, name: user.displayName || (user.email || 'My workspace').split('@')[0], email: user.email || '' };
      activeFilter = 'all';
      currentPage = 'home'; previousPage = 'home'; editorReturnPage = 'home'; editorId = ''; editingNew = false; editorKind = 'note';
      currentFolderPath = '';
      $('#search-input').value = '';
      folderTreeInitialized = false;
      expandedFolders = new Set();
      folders = readCloudFolders(user.uid);
      activeId = '';
      lastSyncAt = readLastSync(user.uid);
      notes = readCloudCache(user.uid);
      replaceAppRoute();
      showApp();
      updateAccountUi();
      setSyncState(navigator.onLine ? 'syncing' : 'offline');
      renderEverything();
      startCloudSyncClock();
      try {
        const sdk = await ensureFirebase();
        sdk.dbGet(sdk.dbRef(sdk.database, `users/${user.uid}/settings/theme`)).then(themeSnapshot => {
          if (themeSnapshot.exists() && ['light','dark'].includes(themeSnapshot.val()) && currentSession?.user?.uid === user.uid) applyTheme(themeSnapshot.val(), true);
        }).catch(error => console.info('Using this device’s appearance preference:', error?.message || error));
        sdk.dbGet(sdk.dbRef(sdk.database, `users/${user.uid}/drafts`)).then(draftSnapshot => {
          if (currentSession?.user?.uid !== user.uid || !draftSnapshot.exists()) return;
          for (const [draftId, remoteDraft] of Object.entries(draftSnapshot.val() || {})) {
            try { localStorage.setItem(editorDraftKey(draftId), JSON.stringify(remoteDraft)); } catch {}
          }
        }).catch(error => console.info('Cloud drafts will retry on next sign-in:', error?.message || error));
        await syncCloudWorkspace(user.uid);
      } catch (error) {
        console.error(error);
        setSyncState('offline');
        renderEverything();
        toast('Showing your local mirror. Firebase will retry automatically when available.', 'error', 6000);
      }
    }
    async function leaveWorkspace(signOut = true) {
      const session = currentSession;
      if (!$('#note-view').classList.contains('hidden')) saveReaderPositionNow(readerRenderedId);
      destroyPdfReader();
      readerRenderedId = '';
      removeHtmlExtractionProbe();
      currentSession = null;
      studySession = null;
      $('#study-session-bar').classList.add('hidden');
      setReviewPopover(false);
      if (syncIntervalId) { clearInterval(syncIntervalId); syncIntervalId = 0; }
      cloudSyncPromise = null;
      if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
      $('#app-shell').classList.remove('focus-mode','pdf-focus-mode','mobile-nav-open');
      showLogin();
      closeAccountMenu(); closeActionMenu(); closeSortMenu();
      clearAuthError();
      if (signOut && session?.mode === 'cloud' && dbSdk) {
        try { await dbSdk.signOut(dbSdk.auth); } catch (error) { console.warn('Firebase sign out:', error); }
      }
    }
    function applySidebarCollapse() {
      const collapsed = sidebarCollapsed && window.matchMedia('(min-width: 681px)').matches;
      $('#app-shell').classList.toggle('sidebar-collapsed',collapsed);
      const button = $('#sidebar-collapse');
      const label = collapsed ? 'Expand navigation' : 'Collapse navigation';
      button.setAttribute('aria-label',label);
      button.setAttribute('title',label);
      button.setAttribute('aria-expanded',String(!collapsed));
      button.innerHTML = collapsed
        ? '<svg class="icon" viewBox="0 0 24 24" fill="none"><path d="m9.5 5 7 7-7 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg class="icon" viewBox="0 0 24 24" fill="none"><path d="m14.5 5-7 7 7 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    function toggleSidebarCollapse() {
      if (!window.matchMedia('(min-width: 681px)').matches) return;
      sidebarCollapsed = !sidebarCollapsed;
      try { localStorage.setItem('notez-sidebar-collapsed-v1',sidebarCollapsed ? '1' : '0'); } catch {}
      applySidebarCollapse();
    }
    function updateStorageGlyph(state) {
      const icon = $('#sync-icon');
      const glyphs = {
        local:'<rect x="4.5" y="5.5" width="15" height="10.5" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 20h8m-6-4v4m4-4v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
        cloud:'<path d="M7 18.2a4.7 4.7 0 0 1-.6-9.35A6 6 0 0 1 18 10.4a3.9 3.9 0 0 1-.4 7.8H7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
        synced:'<path d="M7 18.2a4.7 4.7 0 0 1-.6-9.35A6 6 0 0 1 18 10.4a3.9 3.9 0 0 1-.4 7.8H7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="m9.5 14 1.8 1.8 3.5-3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
        pending:'<path d="M7 18.2a4.7 4.7 0 0 1-.6-9.35A6 6 0 0 1 18 10.4a3.9 3.9 0 0 1-.4 7.8H7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 10.5v3m0 2.5v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
        offline:'<path d="M7 18.2a4.7 4.7 0 0 1-.6-9.35A6 6 0 0 1 18 10.4a3.9 3.9 0 0 1-.4 7.8H7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="m5 5 14 14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
      };
      const colors = { local:'#8d9fb2', cloud:'var(--nz-accent)', synced:'var(--nz-accent)', pending:'#d49a36', offline:'#d49a36' };
      if (icon) { icon.innerHTML = glyphs[state] || glyphs.cloud; icon.style.color = colors[state] || colors.cloud; }
    }
    function updateAccountUi() {
      const isCloud = currentSession?.mode === 'cloud';
      const name = currentSession?.name || 'Demo space';
      const avatar = (currentSession?.email || name || 'D').trim().charAt(0).toUpperCase();
      $('#side-profile-name').textContent = name;
      $('#side-profile-type').textContent = isCloud ? 'Firebase workspace' : 'Local workspace';
      $('#side-avatar').textContent = avatar;
      $('#top-avatar').textContent = avatar;
      $('#account-menu-label').textContent = isCloud ? (currentSession.email || name) : 'Demo workspace · saved locally';
      $('#sync-label').textContent = isCloud ? 'Firebase primary' : 'Local demo';
      $('#sync-copy').innerHTML = isCloud ? 'Cloud + device mirror · <button id="sync-info">Sync details</button>' : 'This device only · <button id="sync-info">How storage works</button>';
      $('#sync-detail').textContent = isCloud ? (lastSyncAt ? `Last sync ${timeText(lastSyncAt)} · every 30 sec` : 'Checking Firebase and local mirror…') : 'Saved on this device';
      $('#sync-now').classList.toggle('hidden', !isCloud);
      updateStorageGlyph(isCloud ? 'cloud' : 'local');
    }
    function setSyncState(state) {
      const label = $('#sync-label');
      if (!currentSession) return;
      if (currentSession.mode !== 'cloud') {
        label.textContent = 'Local demo';
        $('#sync-detail').textContent = 'Saved on this device';
        updateStorageGlyph('local');
        return;
      }
      if (state === 'syncing' || state === 'connecting') {
        label.textContent = 'Syncing…';
        $('#sync-detail').textContent = `Checking Firebase · ${readPendingIds(currentSession.user.uid).length + (localStorage.getItem(cloudFoldersPendingKey(currentSession.user.uid)) === '1' ? 1 : 0)} pending`;
        updateStorageGlyph('cloud');
      } else if (state === 'cloud') {
        lastSyncAt = Date.now();
        try { localStorage.setItem(cloudSyncTimeKey(currentSession.user.uid), String(lastSyncAt)); } catch {}
        label.textContent = 'Synced';
        $('#sync-detail').textContent = 'Last sync just now · auto-sync every 30 sec';
        updateStorageGlyph('synced');
      } else if (state === 'pending') {
        label.textContent = 'Sync pending';
        $('#sync-detail').textContent = 'Changes are safe on this device · retrying';
        updateStorageGlyph('pending');
      } else {
        label.textContent = 'Offline · cached';
        $('#sync-detail').textContent = 'Local mirror is safe · sync retries when online';
        updateStorageGlyph('offline');
      }
    }
    function saveCurrentData() {
      if (currentSession?.mode === 'demo') return localNotesWrite();
      if (currentSession?.mode === 'cloud') return writeCloudCache(currentSession.user.uid, notes);
      return false;
    }
    const semanticIndexTimers = new Map();
    function queueSemanticIndex(noteId, uidValue) {
      if (!window.notezAiBackendConfigured?.() || typeof window.notezAiIndexNote !== 'function') return;
      const prior = semanticIndexTimers.get(noteId);
      if (prior) clearTimeout(prior);
      semanticIndexTimers.set(noteId, setTimeout(async () => {
        semanticIndexTimers.delete(noteId);
        if (currentSession?.mode !== 'cloud' || currentSession.user.uid !== uidValue || !navigator.onLine) return;
        try { await window.notezAiIndexNote(noteId); }
        catch (error) {
          // A provider quota (429) is not a failed save: the note is stored and
          // the next edit or AI request retries the index update.
          if (error?.status === 429) return;
          console.warn('Note saved, but its semantic index update failed:', noteId, error);
          toast('Note saved to Firebase, but its semantic index could not be updated. Use NotezAi settings to rebuild it.', 'error', 6500);
        }
      }, 800));
    }
    async function saveCloudNote(note, uidValue = currentSession?.user?.uid) {
      if (!uidValue) throw new Error('No authenticated workspace');
      const sdk = await ensureFirebase();
      const clean = normalizeNote(note);
      await sdk.dbSet(sdk.dbRef(sdk.database, `users/${uidValue}/notes/${clean.id}`), clean);
      queueSemanticIndex(clean.id, uidValue);
    }
    // Attachments are kept in the Realtime Database (no Firebase Storage / paid plan needed).
    // Files are split into small base64 chunks so a single file can be up to 150 MB.
    const CLOUD_FILE_LIMIT = 150 * 1024 * 1024;
    const CLOUD_CHUNK_BYTES = 510000; // multiple of 3 so base64 chunks join cleanly (~680 KB each)
    const CLOUD_CHUNK_PARALLEL = 4;
    // PDF -> low-size page images. Lower these numbers for even smaller files.
    const PDF_PAGE_PIXEL_WIDTH = 1800;
    const PDF_JPEG_QUALITY = 0.72;
    function blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(reader.error || new Error('Could not read file'));
        reader.readAsDataURL(blob);
      });
    }
    function base64ToBlob(b64, type) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: type || 'application/octet-stream' });
    }
    // Returns the cloud path, or '' when the file is too large and stays on this device only.
    async function uploadCloudFile(sdk, uid, noteId, file, mime) {
      if (file.size > CLOUD_FILE_LIMIT) return '';
      const path = `users/${uid}/files/${noteId}`;
      const count = Math.max(1, Math.ceil(file.size / CLOUD_CHUNK_BYTES));
      for (let start = 0; start < count; start += CLOUD_CHUNK_PARALLEL) {
        const batch = [];
        for (let i = start; i < Math.min(count, start + CLOUD_CHUNK_PARALLEL); i++) {
          batch.push((async () => {
            const data = await blobToBase64(file.slice(i * CLOUD_CHUNK_BYTES, (i + 1) * CLOUD_CHUNK_BYTES));
            await sdk.dbSet(sdk.dbRef(sdk.database, `${path}/c/${i}`), data);
          })());
        }
        await Promise.all(batch);
      }
      // Meta is written last, so a half-finished upload is never treated as a complete file.
      await sdk.dbSet(sdk.dbRef(sdk.database, `${path}/meta`), { type: mime || file.type || 'application/octet-stream', size: file.size, chunks: count });
      return path;
    }
    async function downloadCloudFile(sdk, path) {
      const metaSnap = await sdk.dbGet(sdk.dbRef(sdk.database, `${path}/meta`));
      if (!metaSnap.exists()) return null;
      const meta = metaSnap.val();
      const parts = new Array(meta.chunks);
      for (let start = 0; start < meta.chunks; start += CLOUD_CHUNK_PARALLEL) {
        const batch = [];
        for (let i = start; i < Math.min(meta.chunks, start + CLOUD_CHUNK_PARALLEL); i++) {
          batch.push((async () => {
            const snap = await sdk.dbGet(sdk.dbRef(sdk.database, `${path}/c/${i}`));
            if (!snap.exists()) throw new Error('Attachment chunk missing');
            parts[i] = base64ToBlob(snap.val(), meta.type);
          })());
        }
        await Promise.all(batch);
      }
      return new Blob(parts, { type: meta.type || 'application/octet-stream' });
    }
    async function deleteCloudFile(sdk, path) {
      await sdk.dbRemove(sdk.dbRef(sdk.database, path));
    }
    function buildJpegPdf(pages) {
      const enc = new TextEncoder();
      const parts = []; let offset = 0; const offsets = [];
      const push = data => { const b = typeof data === 'string' ? enc.encode(data) : data; parts.push(b); offset += b.length; };
      const n = pages.length;
      push('%PDF-1.4\n');
      offsets[1] = offset; push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
      offsets[2] = offset; push(`2 0 obj\n<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] >>\nendobj\n`);
      pages.forEach((pg, i) => {
        const pageNo = 3 + 3 * i, imgNo = 4 + 3 * i, contentNo = 5 + 3 * i;
        const w = pg.ptW.toFixed(2), h = pg.ptH.toFixed(2);
        offsets[pageNo] = offset;
        push(`${pageNo} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imgNo} 0 R >> >> /Contents ${contentNo} 0 R >>\nendobj\n`);
        offsets[imgNo] = offset;
        push(`${imgNo} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.length} >>\nstream\n`);
        push(pg.bytes); push('\nendstream\nendobj\n');
        const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
        offsets[contentNo] = offset;
        push(`${contentNo} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
      });
      const total = 3 * n + 3, xrefPos = offset;
      let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
      for (let k = 1; k < total; k++) xref += String(offsets[k]).padStart(10, '0') + ' 00000 n \n';
      push(xref + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);
      return new Blob(parts, { type: 'application/pdf' });
    }
    // Renders every page to a small JPEG and rebuilds a PDF from those images.
    // Falls back to the original file if the result would not be smaller.
    const PDF_KEEP_ORIGINAL = true;   // PDFs are saved exactly as uploaded and never converted into notes
    // Reads the text layer of a PDF without rendering or changing it.
    async function readPdfTextLayer(blob) {
      const pdfjs = await loadPdfJs();
      const data = new Uint8Array(await blob.arrayBuffer());
      const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
      const pageTexts = [];
      try {
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          try {
            const content = await page.getTextContent(), rows = [];
            for (const item of content.items) {
              if (!item.str || !item.str.trim()) continue;
              const y = Math.round(item.transform[5]), row = rows.find(entry => Math.abs(entry.y - y) <= 2);
              if (row) row.items.push(item); else rows.push({ y, items: [item] });
            }
            rows.sort((a, b) => b.y - a.y);
            pageTexts[n - 1] = rows.map(row => row.items.sort((a, b) => a.transform[4] - b.transform[4]).map(item => item.str).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
          } finally { page.cleanup?.(); }
        }
      } finally { doc.destroy?.(); }
      const pages = Array.from(pageTexts, text => text || '');
      const text = pages.map((body, i) => body ? `— Page ${i + 1} —\n${body}` : '').filter(Boolean).join('\n\n');
      return { text, pageTexts: pages };
    }
    async function compressPdfToImages(file, onProgress) {
      const pdfjs = await loadPdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
      const pages = [], texts = [], pageTexts = [];
      try {
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          try {
            // Group text items into visual lines so headings, list items and paragraphs keep their breaks.
            const content = await page.getTextContent(), rows = [];
            for (const item of content.items) {
              if (!item.str || !item.str.trim()) continue;
              const y = Math.round(item.transform[5]), row = rows.find(entry => Math.abs(entry.y - y) <= 2);
              if (row) row.items.push(item); else rows.push({ y, items: [item] });
            }
            rows.sort((a, b) => b.y - a.y);
            const line = rows.map(row => row.items.sort((a, b) => a.transform[4] - b.transform[4]).map(item => item.str).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
            pageTexts[n - 1] = line; if (line) texts.push(`— Page ${n} —\n${line}`);
          } catch {}
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(4, PDF_PAGE_PIXEL_WIDTH / Math.max(1, base.width));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.ceil(viewport.width));
          canvas.height = Math.max(1, Math.ceil(viewport.height));
          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport }).promise;
          const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', PDF_JPEG_QUALITY));
          if (!jpeg) throw new Error('Could not encode page image');
          pages.push({ width: canvas.width, height: canvas.height, ptW: base.width, ptH: base.height, bytes: new Uint8Array(await jpeg.arrayBuffer()) });
          canvas.width = canvas.height = 0;
          page.cleanup();
          if (onProgress) onProgress(n, doc.numPages);
        }
      } finally { try { await doc.destroy(); } catch {} }
      const extracted = texts.join('\n\n');
      const perPage = Array.from(pageTexts, text => text || '');
      const pageImages = pages.map(page => page.bytes);
      if (!pages.length) { file.notezText = extracted; file.notezPageTexts = perPage; file.notezPageImages = pageImages; return file; }
      const blob = buildJpegPdf(pages);
      if (blob.size >= file.size) { file.notezText = extracted; file.notezPageTexts = perPage; file.notezPageImages = pageImages; return file; }
      const output = new File([blob], file.name, { type: 'application/pdf', lastModified: Date.now() });
      output.notezText = extracted; output.notezPageTexts = perPage; output.notezPageImages = pageImages;
      return output;
    }
    async function prepareCloudAttachment(note, uidValue = currentSession?.user?.uid) {
      if (!note.fileName || note.filePath || !uidValue) return note;
      const file = await getLocalFile(note.id);
      if (!file) throw new Error(`Local attachment is unavailable: ${note.fileName}`);
      const sdk = await ensureFirebase();
      const path = await uploadCloudFile(sdk, uidValue, note.id, file, note.mimeType);
      if (path) note.filePath = path;
      return note;
    }
    async function syncCloudWorkspace(uidValue = currentSession?.user?.uid) {
      if (!uidValue || currentSession?.mode !== 'cloud' || currentSession.user.uid !== uidValue || !navigator.onLine) {
        if (currentSession?.mode === 'cloud') setSyncState('offline');
        return;
      }
      if (cloudSyncPromise) return cloudSyncPromise;
      const task = (async () => {
        setSyncState('syncing');
        const sdk = await ensureFirebase();
        try { await flushCloudFolders(uidValue, sdk); } catch (folderError) { console.warn('Folder sync is queued:', folderError); }
        const snapshot = await sdk.dbGet(sdk.dbRef(sdk.database, `users/${uidValue}/notes`));
        const remoteData = snapshot.exists() ? snapshot.val() : {};
        const remote = new Map(Object.entries(remoteData || {}).map(([id, raw]) => [id, normalizeNote(raw, id)]));
        const tombstones = readCloudDeletions(uidValue);
        for (const [deletedId, tombstone] of Object.entries(tombstones)) {
          remote.delete(deletedId);
          try {
            await sdk.dbRemove(sdk.dbRef(sdk.database, `users/${uidValue}/notes/${deletedId}`));
            if (window.notezAiBackendConfigured?.() && typeof window.notezAiDeleteIndexedNote === 'function') {
              try { await window.notezAiDeleteIndexedNote(deletedId); }
              catch (indexError) { console.warn('Firebase note deletion succeeded; semantic index cleanup will be retried:', indexError); }
            }
            if (tombstone?.filePath && tombstone.filePath.includes('/files/')) await deleteCloudFile(sdk, tombstone.filePath);
            setCloudDeletion(uidValue, deletedId, null);
            markPending(uidValue, deletedId, false);
          } catch (deleteError) { console.warn('A delete is queued for Firebase retry:', deletedId, deleteError); }
        }
        const cachedRecords = readCloudCache(uidValue);
        const cached = new Map(cachedRecords.map(note => [note.id, note]));
        // In-memory edits not yet written to the cache are included in the reconciliation pass.
        if (currentSession?.user?.uid === uidValue) notes.forEach(note => cached.set(note.id, normalizeNote(note)));
        const pending = new Set(readPendingIds(uidValue));
        const allIds = new Set([...remote.keys(), ...cached.keys(), ...pending]);
        const merged = [];
        const syncedMap = readSyncedMap(uidValue);
        const conflictCopies = [];
        for (const id of allIds) {
          if (currentSession?.user?.uid !== uidValue) return;
          const localNote = cached.get(id);
          const remoteNote = remote.get(id);
          if (isNoteConflict(localNote, remoteNote, syncedMap, pending.has(id))) {
            const copy = normalizeNote({ ...localNote, id: uid(), title: `${localNote.title} (conflict copy)`.slice(0, 200), fileName: '', mimeType: '', filePath: '', fileSize: 0, kind: localNote.fileName ? 'markdown' : localNote.kind, createdAt: Date.now(), updatedAt: Date.now(), lastViewedAt: 0 });
            conflictCopies.push(copy);
            const list = readConflicts().filter(item => item.copyId !== copy.id); list.unshift({ copyId: copy.id, title: localNote.title, at: Date.now() }); writeConflicts(list);
            merged.push(remoteNote); markPending(uidValue, id, false);
            continue;
          }
          const localNeedsPush = localNote && pending.has(id) && (!remoteNote || localNote.updatedAt >= remoteNote.updatedAt);
          if (localNeedsPush) {
            try {
              const prepared = normalizeNote(localNote);
              await prepareCloudAttachment(prepared, uidValue);
              await saveCloudNote(prepared, uidValue);
              merged.push(prepared);
              markPending(uidValue, id, false);
              remote.set(id, prepared);
            } catch (error) {
              console.warn('A note remains queued for Firebase:', id, error);
              merged.push(localNote);
            }
          } else if (remoteNote) {
            const localSourceStillMatches = localNote && localNote.kind === 'html' && localNote.kind === remoteNote.kind && localNote.updatedAt === remoteNote.updatedAt && localNote.filePath === remoteNote.filePath && localNote.fileName === remoteNote.fileName && localNote.fileSize === remoteNote.fileSize && localNote.htmlSource === remoteNote.htmlSource && localNote.body === remoteNote.body;
            if (localSourceStillMatches && cachedReadableHtmlForNote(localNote) && !cachedReadableHtmlForNote(remoteNote)) {
              remoteNote.htmlReadableText = localNote.htmlReadableText;
              remoteNote.htmlReadableSourceKey = localNote.htmlReadableSourceKey;
            }
            merged.push(remoteNote);
            if (pending.has(id)) markPending(uidValue, id, false);
          } else if (localNote && pending.has(id)) {
            // A locally created note can be retried even if the remote write never completed.
            try {
              const prepared = normalizeNote(localNote);
              await prepareCloudAttachment(prepared, uidValue);
              await saveCloudNote(prepared, uidValue);
              merged.push(prepared);
              markPending(uidValue, id, false);
            } catch (error) { console.warn('A new note remains queued:', error); merged.push(localNote); }
          }
        }
        if (currentSession?.user?.uid !== uidValue) return;
        for (const copy of conflictCopies) { merged.push(copy); markPending(uidValue, copy.id, true); }
        writeSyncedMap(uidValue, merged);
        notes = merged.sort((a,b) => b.updatedAt - a.updatedAt);
        if (!notes.some(note => note.id === activeId)) activeId = notes[0]?.id || '';
        writeCloudCache(uidValue, notes);
        const changedSignature = notesSignatureOf(notes);
        const visibleChange = changedSignature !== lastNotesSignature;
        lastNotesSignature = changedSignature;
        const pendingCount = readPendingIds(uidValue).length + Object.keys(readCloudDeletions(uidValue)).length + (localStorage.getItem(cloudFoldersPendingKey(uidValue)) === '1' ? 1 : 0);
        if (visibleChange) renderEverything();
        setSyncState(pendingCount ? 'pending' : 'cloud');
      })();
      cloudSyncPromise = task;
      try { await task; } finally { if (cloudSyncPromise === task) cloudSyncPromise = null; }
    }
    function startCloudSyncClock() {
      if (syncIntervalId) clearInterval(syncIntervalId);
      syncIntervalId = window.setInterval(() => {
        if (currentSession?.mode === 'cloud') syncCloudWorkspace().catch(error => { console.warn(error); setSyncState('offline'); });
      }, CLOUD_SYNC_INTERVAL);
    }
    function refreshReviewIndicators() {
      if (!currentSession) return;
      const due = notes.filter(note => isReviewDue(note));
      const signature = due.map(note => note.id).sort().join('|');
      const queueChanged = Boolean(reviewDueSignature) && signature !== reviewDueSignature;
      reviewDueSignature = signature;
      $('#review-count').textContent = due.length;
      if (currentPage === 'home') updateStudyLaunchCard(due);
      if (currentPage === 'notes' && activeFilter === 'review' && queueChanged) renderNotesPage();
      if (currentPage === 'reader') updateReviewControl(notes.find(note => note.id === activeId));
    }
    function startReviewClock() {
      if (reviewClockId) clearInterval(reviewClockId);
      reviewClockId = window.setInterval(refreshReviewIndicators, 60_000);
    }
    async function persistNote(note) {
      if (noteSaving) return; // Prevent duplicate saves
      noteSaving = true;
      if (currentSession?.mode === 'demo') { localNotesWrite(); noteSaving = false; return; }
      if (currentSession?.mode === 'cloud') {
        const uidValue = currentSession.user.uid;
        // Persist to the timestamped outbox immediately so refresh/offline cannot lose a change.
        updateCachedCloudNote(note, true);
        if (!navigator.onLine) { setSyncState('offline'); return; }
        setSyncState('syncing');
        try {
          const prepared = normalizeNote(note);
          await prepareCloudAttachment(prepared, uidValue);
          await saveCloudNote(prepared, uidValue);
          notes = notes.map(item => item.id === prepared.id ? prepared : item);
          markPending(uidValue, prepared.id, false);
          writeCloudCache(uidValue, notes);
          setSyncState(hasPendingCloudChanges(uidValue) ? 'pending' : 'cloud');
        } catch (error) { setSyncState('pending'); noteSaving = false; throw error; }
        noteSaving = false;
      }
      // Trigger knowledge index update after successful save
      if (currentSession && typeof window.enqueueForIndexing === 'function') {
        try {
          await window.enqueueForIndexing(note.id, note, 'index');
        } catch (error) {
          console.warn('Note saved, but knowledge index update failed:', error);
        }
      }
    }

    let noteSaving = false;
const noteSearchCache = new WeakMap();
    function foldSearchText(value = '') {
      return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }
    function noteSearchIndex(note) {
      const tags = (note.tags || []).join(' ');
      const cached = noteSearchCache.get(note);
      if (cached && cached.title === note.title && cached.subject === note.subject && cached.folderPath === note.folderPath && cached.tags === tags && cached.fileName === note.fileName && cached.body === note.body && cached.htmlSource === note.htmlSource && cached.htmlReadableText === note.htmlReadableText && cached.htmlReadableSourceKey === note.htmlReadableSourceKey && cached.updatedAt === note.updatedAt) return cached.text;
      const source = note.kind === 'html' ? htmlSourceForNote(note) : '';
      const body = isHtmlSource(note.body) ? extractReadableHtml(note.body) : note.body;
      const readable = cachedReadableHtmlForNote(note) || (source ? extractReadableHtml(source) : '');
      const text = foldSearchText([note.title,note.subject,note.folderPath,tags,note.fileName,note.mimeType,body,readable].join(' '));
      noteSearchCache.set(note, { title:note.title, subject:note.subject, folderPath:note.folderPath, tags, fileName:note.fileName, body:note.body, htmlSource:note.htmlSource, htmlReadableText:note.htmlReadableText, htmlReadableSourceKey:note.htmlReadableSourceKey, updatedAt:note.updatedAt, text });
      return text;
    }
    function parseNoteSearchQuery(query) {
      const source = String(query || '');
      const phrases = [...source.matchAll(/"([^"]+)"/g)].map(match => foldSearchText(match[1]).trim()).filter(Boolean);
      const terms = foldSearchText(source.replace(/"[^"]*"/g, ' ')).split(/\s+/).filter(Boolean);
      return { phrases, terms, all:[...new Set([...phrases,...terms])] };
    }
    function editDistance(a, b, limit = 2) {
      if (Math.abs(a.length - b.length) > limit) return limit + 1;
      let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        const cur = [i]; let best = cur[0];
        for (let j = 1; j <= b.length; j++) {
          cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
          best = Math.min(best, cur[j]);
        }
        if (best > limit) return limit + 1;
        prev = cur;
      }
      return prev[b.length];
    }
    function noteMatchesSearch(note, query) {
      const parsed = parseNoteSearchQuery(query);
      const index = noteSearchIndex(note);
      if (parsed.phrases.every(phrase => index.includes(phrase)) && parsed.terms.every(term => index.includes(term))) return true;
      // Typo tolerance: each typed word may match a similar word in the note (1 edit for short words, 2 for long).
      const words = index.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      return parsed.terms.length > 0 && parsed.terms.every(term => {
        if (term.length < 4 || index.includes(term)) return index.includes(term);
        const allowed = term.length >= 8 ? 2 : 1;
        return words.some(word => editDistance(term, word, allowed) <= allowed);
      });
    }
    function noteSearchScore(note, query) {
      const parsed = parseNoteSearchQuery(query);
      const title = foldSearchText(note.title);
      const subject = foldSearchText(note.subject);
      const tags = foldSearchText((note.tags || []).join(' '));
      const path = foldSearchText(note.folderPath);
      const file = foldSearchText(note.fileName);
      let score = 0;
      for (const term of parsed.all) {
        if (title.includes(term)) score += 12;
        if (subject.includes(term)) score += 5;
        if (tags.includes(term)) score += 4;
        if (path.includes(term) || file.includes(term)) score += 2;
      }
      return score;
    }
    // Search operators: tag:chapter-3  folder:biology  type:pdf  is:starred|pinned|covered|due|untagged  before:2026-01-01  after:2026-01-01
    function splitSearchOps(raw) {
      const ops = {};
      const text = String(raw || '').replace(/\b(tag|folder|type|is|before|after):(\S+)/gi, (_, key, value) => { (ops[key.toLowerCase()] ||= []).push(value.toLowerCase()); return ' '; }).replace(/\s+/g, ' ').trim();
      return { ops, text };
    }
    function opsMatch(note, ops) {
      const day = value => new Date(value).toISOString().slice(0, 10);
      const ext = String(note.fileName || '').split('.').pop().toLowerCase();
      for (const value of ops.tag || []) { const want = value.replace(/-/g, ' '); if (!(note.tags || []).some(tag => tag.toLowerCase() === want || tag.toLowerCase() === value)) return false; }
      for (const value of ops.folder || []) { const path = String(note.folderPath || '').toLowerCase(); if (!(path === value || path.startsWith(value + '/') || path.includes(value))) return false; }
      for (const value of ops.type || []) { const kinds = [note.kind, ext, isPdfNote(note) ? 'pdf' : '']; if (!kinds.includes(value)) return false; }
      for (const value of ops.is || []) {
        const ok = value === 'starred' ? !!note.favorite : value === 'pinned' ? !!note.pinned : value === 'covered' ? progressOf(note) >= 0.9 : value === 'due' ? isReviewDue(note) : value === 'untagged' ? !(note.tags || []).length : true;
        if (!ok) return false;
      }
      for (const value of ops.before || []) { if (!(day(note.updatedAt) < value)) return false; }
      for (const value of ops.after || []) { if (!(day(note.updatedAt) > value)) return false; }
      return true;
    }
    function getFilteredNotes() {
      const { ops, text: query } = splitSearchOps($('#search-input')?.value || '');
      let result = notes.filter(note => {
        const noteFolder = cleanFolderPath(note.folderPath);
        if (currentFolderPath && noteFolder !== currentFolderPath && !noteFolder.startsWith(`${currentFolderPath}/`)) return false;
        if (!opsMatch(note, ops)) return false;
        if (activeFilter === 'starred' && !note.favorite) return false;
        if (prioFilter === 'pinned' && !note.pinned) return false;
        if (['high', 'medium', 'low'].includes(prioFilter) && note.priority !== prioFilter) return false;
        if (activeFilter === 'recent' && !(Number(note.lastViewedAt) > 0)) return false;
        if (activeFilter === 'review' && !isReviewDue(note)) return false;
        if (query && !noteMatchesSearch(note, query)) return false;
        return true;
      });
      result.sort((a,b) => {
        if (query) { const relevance = noteSearchScore(b, query) - noteSearchScore(a, query); if (relevance) return relevance; }
        if (!query && Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        if (sortMode === 'title') return a.title.localeCompare(b.title, undefined, { sensitivity:'base' });
        if (activeFilter === 'recent') {
          const aViewed = Number(a.lastViewedAt) || 0, bViewed = Number(b.lastViewedAt) || 0;
          return sortMode === 'oldest' ? aViewed - bViewed : bViewed - aViewed;
        }
        if (activeFilter === 'review') {
          const aDue = Number(a.reviewDueAt) || 0, bDue = Number(b.reviewDueAt) || 0;
          return sortMode === 'oldest' ? bDue - aDue || a.updatedAt - b.updatedAt : aDue - bDue || b.updatedAt - a.updatedAt;
        }
        return sortMode === 'oldest' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt;
      });
      return result;
    }
    function filterLabel() {
      if (currentFolderPath) return currentFolderPath.split('/').pop();
      if (activeFilter === 'starred') return 'Starred';
      if (activeFilter === 'recent') return 'Recently viewed';
      if (activeFilter === 'review') return 'Review queue';
      return 'All notes';
    }
    function folderNoteCount(path, includeChildren = true) {
      return notes.filter(note => {
        const notePath = cleanFolderPath(note.folderPath);
        return includeChildren ? (notePath === path || notePath.startsWith(`${path}/`)) : notePath === path;
      }).length;
    }
    function noteExcerptMarkup(note, query = '') {
      let raw = note.body && !isHtmlSource(note.body) ? note.body : '';
      const cachedHtmlText = cachedReadableHtmlForNote(note);
      if (note.kind === 'html' && (!raw || note.bodyPreviewOnly)) raw = cachedHtmlText || extractReadableHtml(htmlSourceForNote(note)) || raw;
      if (!raw && cachedHtmlText) raw = cachedHtmlText;
      if (!raw && isHtmlSource(note.body)) raw = extractReadableHtml(note.body);
      if (!raw) raw = note.fileName || '';
      // A recording note stores speaker labels on their own lines; the excerpt
      // reads them like the note does ("Voice 1:"), never as a raw "spk0:".
      const labelled = typeof window.nzNormalizeSpeakerLabels === 'function' ? window.nzNormalizeSpeakerLabels(raw) : raw;
      let text = String(labelled || '').replace(/\r/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^#{1,6}\s*/gm, '').replace(/[`*_~]/g, '').replace(/^>\s*/gm, '').replace(/\[\d{2}:\d{2}(?::\d{2})?\]\s*/g, '').replace(/\s+/g, ' ').trim();
      if (!text) return '';
      const terms = String(query || '').replace(/"([^"]+)"/g, '$1').split(/\s+/).map(term => term.trim()).filter(term => term.length > 1);
      let hit = -1;
      const foldedText = foldSearchText(text);
      for (const term of terms) {
        const index = foldedText.indexOf(foldSearchText(term));
        if (index >= 0 && (hit < 0 || index < hit)) hit = index;
      }
      const start = hit < 0 ? 0 : Math.max(0, hit - 48);
      const end = Math.min(text.length, start + 138);
      let snippet = `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
      const escapedTerms = [...new Set(terms)].sort((a,b) => b.length - a.length).map(term => [...term].map(char => '.+*?^${}()|[]\\'.includes(char) ? `\\${char}` : char).join(''));
      if (escapedTerms.length) {
        const pattern = new RegExp(`(${escapedTerms.join('|')})`, 'ig');
        snippet = snippet.split(pattern).map(part => terms.some(term => foldSearchText(part) === foldSearchText(term)) ? `<mark>${esc(part)}</mark>` : esc(part)).join('');
        return snippet;
      }
      return esc(snippet);
    }
    function noteCardMarkup(note, compact = false, dateMode = 'updated') {
      const iconName = ['note','markdown','html','text','pdf','image','audio','video','file'].includes(note.kind) ? note.kind : 'file';
      const iconClass = ['markdown','note','pdf','image'].includes(iconName) ? iconName : '';
      const excerpt = noteExcerptMarkup(note, ($('#search-input')?.value || '').trim());
      const date = timeText(dateMode === 'opened' ? note.lastViewedAt : note.updatedAt);
      const dateLabel = dateMode === 'opened' ? 'Opened' : 'Updated';
      const reviewBadge = isReviewDue(note) ? '<span class="review-chip review-overdue">Review due</span>' : isNewNote(note) ? '<span class="review-chip review-new">New</span>' : note.reviewDueAt ? `<span class="review-chip review-upcoming">Due ${esc(reviewDueLabel(note))}</span>` : note.completed ? '<span class="review-chip">Reviewed</span>' : '';
      return `<article draggable="true" class="note-tile ${compact ? 'compact' : ''} ${selectionMode ? 'selecting' : ''} ${selectedNoteIds.has(note.id) ? 'selected' : ''}" data-note-tile="${esc(note.id)}">
        <button type="button" class="note-tile-main" data-note-open="${esc(note.id)}" aria-label="Open ${esc(note.title)}">
          <span class="note-tile-top"><span class="file-symbol ${iconClass}">${svgIcon(iconName,16)}</span><span class="note-tile-kind">${esc(kindLabel(note.kind))}</span></span>
          <strong class="note-tile-title">${esc(note.title)}</strong>
          <span class="note-tile-meta">${esc(note.folderPath || note.subject || 'Unfiled')} <i class="dot"></i> ${dateLabel} ${esc(date)}</span>
          ${excerpt ? `<span class="note-tile-excerpt">${excerpt}</span>` : `<span class="note-tile-excerpt muted-excerpt">${isReviewDue(note) ? 'Ready for a spaced review.' : note.reviewDueAt ? `Next review ${esc(reviewDueLabel(note))}.` : 'Open to continue studying.'}</span>`}
          <span class="note-tile-bottom"><span class="note-tile-subject">${esc(note.subject || 'General')}</span>${reviewBadge}</span>
        </button>
        ${selectionMode ? `<button type="button" class="tile-select-button" data-select-id="${esc(note.id)}" aria-label="${selectedNoteIds.has(note.id) ? 'Deselect' : 'Select'} ${esc(note.title)}" aria-pressed="${selectedNoteIds.has(note.id)}" title="${selectedNoteIds.has(note.id) ? 'Deselect note' : 'Select note'}"><span>${selectedNoteIds.has(note.id) ? svgIcon('check',12) : ''}</span></button>` : ''}
        <button type="button" class="tile-star ${note.favorite ? 'is-starred' : ''}" data-star-id="${esc(note.id)}" aria-label="${note.favorite ? 'Remove from starred' : 'Add to starred'}" title="${note.favorite ? 'Remove from starred' : 'Add to starred'}"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m12 3.8 2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.82l-5.1 2.68.97-5.68-4.12-4.02 5.7-.83L12 3.8Z"/></svg></button>
        <button type="button" class="tile-menu-button" data-note-menu="${esc(note.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${esc(note.title)}" title="More note actions">${svgIcon('more',14)}</button>
      </article>`;
    }
