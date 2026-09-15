/* ============================= three.js PCB-trace backdrop ============================= */
(function(){
  const canvas = document.getElementById('bg-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.1, 100);
  camera.position.set(0,0,11);

  function resize(){
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  const COUNT = 90;
  const positions = new Float32Array(COUNT*3);
  const velocities = [];
  for(let i=0;i<COUNT;i++){
    positions[i*3]   = (Math.random()-0.5)*20;
    positions[i*3+1] = (Math.random()-0.5)*12;
    positions[i*3+2] = (Math.random()-0.5)*6;
    velocities.push([(Math.random()-0.5)*0.004, (Math.random()-0.5)*0.004, 0]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  const mat = new THREE.PointsMaterial({ color:0xe8c86a, size:0.06, transparent:true, opacity:0.85 });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  const lineGeo = new THREE.BufferGeometry();
  const lineMat = new THREE.LineBasicMaterial({ color:0x9c988a, transparent:true, opacity:0.22 });
  const lineMesh = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(lineMesh);

  const MAXD = 3.4;
  function updateLines(){
    const verts = [];
    for(let i=0;i<COUNT;i++){
      for(let j=i+1;j<COUNT;j++){
        const dx=positions[i*3]-positions[j*3], dy=positions[i*3+1]-positions[j*3+1], dz=positions[i*3+2]-positions[j*3+2];
        const d = Math.sqrt(dx*dx+dy*dy+dz*dz);
        if(d<MAXD){
          verts.push(positions[i*3],positions[i*3+1],positions[i*3+2]);
          verts.push(positions[j*3],positions[j*3+1],positions[j*3+2]);
        }
      }
    }
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts),3));
  }
  let frame=0;
  function tick(){
    for(let i=0;i<COUNT;i++){
      positions[i*3]   += velocities[i][0];
      positions[i*3+1] += velocities[i][1];
      if(Math.abs(positions[i*3])>10) velocities[i][0]*=-1;
      if(Math.abs(positions[i*3+1])>6) velocities[i][1]*=-1;
    }
    geo.attributes.position.needsUpdate = true;
    if(frame%4===0) updateLines();
    points.rotation.y += 0.0006;
    lineMesh.rotation.y += 0.0006;
    frame++;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
})();

/* ============================= circuit simulator ============================= */
(function(){
  const INPUT_COUNT = { 
    INPUT: 0, BUTTON: 0, CLOCK: 0, OSCLOCK: 1, OUTPUT: 1, SPEAKER: 1, LCD: 4, SEVEN: 7, FOURTEEN: 18, 
    NOT: 1, AND: 2, OR: 2, NAND: 2, NOR: 2, XOR: 2, XNOR: 2, MEMORY: 2,
    DELAY: 1, CALCULATOR: 2, GREATER: 2, XAND: 2, JOYSTICK: 0 
  };

  const LABELS = { 
    INPUT: 'SW', BUTTON: 'BTN', CLOCK: 'CLK', OSCLOCK: 'OS CLK', OUTPUT: 'LAMP', SPEAKER: 'SPEAKER', LCD: 'LCD', SEVEN: '7-SEG', FOURTEEN: '14 Segment', 
    NOT: 'NOT', AND: 'AND', OR: 'OR', NAND: 'NAND', NOR: 'NOR', XOR: 'XOR', XNOR: 'XNOR', MEMORY: 'MEM',
    DELAY: 'DELAY', CALCULATOR: 'CALC', GREATER: 'GREATER', XAND: 'XAND', JOYSTICK: 'Joystick' 
  };

  const canvasInner = document.getElementById('canvasInner');
  const canvasWrap  = document.getElementById('canvasWrap');
  const zoomStage   = document.getElementById('zoomStage');
  const wireLayer   = document.getElementById('wireLayer');
  const toastEl     = document.getElementById('toast');
  const selectionBox = document.getElementById('selectionBox');

  document.addEventListener('copy', e => e.preventDefault());

  let nodes = new Map();     
  let wires = [];            
  const inputWires = new Map();
  let nodeSeq = 0, wireSeq = 0;
  let pendingWireFrom = null; 
  let mousePos = { x: 0, y: 0 };
  let selectedNodeIds = new Set();
  let isSelecting = false;
  let selectStart = { x: 0, y: 0 };
  let nodeScale = 1;
  const customChips = new Map();
  const customChipsEl = document.getElementById('customChips');
  const CUSTOM_CHIPS_STORAGE_KEY = 'breadboard-custom-chips';

  function isCustomChip(type){ return typeof type === 'string' && type.startsWith('CHIP:'); }
  function chipKey(name){ return 'CHIP:' + name; }

  function registerChip(definition){
    const type = chipKey(definition.name);
    customChips.set(type, definition);
    INPUT_COUNT[type] = definition.inputs.length;
    LABELS[type] = definition.name;
    const persisted = persistCustomChips();
    renderCustomChips();
    return { type, persisted };
  }

  function persistCustomChips(){
    const payload = JSON.stringify(Object.fromEntries(customChips));
    try {
      localStorage.setItem(CUSTOM_CHIPS_STORAGE_KEY, payload);
      if(localStorage.getItem(CUSTOM_CHIPS_STORAGE_KEY) !== payload) throw new Error('Storage verification failed');
      return true;
    } catch(err) {
      try {
        sessionStorage.setItem(CUSTOM_CHIPS_STORAGE_KEY, payload);
        return false;
      } catch(sessionErr) {
        return false;
      }
    }
  }

  function restoreCustomChips(){
    try {
      const storedValue = localStorage.getItem(CUSTOM_CHIPS_STORAGE_KEY) || sessionStorage.getItem(CUSTOM_CHIPS_STORAGE_KEY) || '{}';
      const stored = JSON.parse(storedValue);
      Object.values(stored).forEach(definition => {
        if(definition && definition.name && Array.isArray(definition.inputs) && Array.isArray(definition.outputs)) {
          const type = chipKey(definition.name);
          customChips.set(type, definition);
          INPUT_COUNT[type] = definition.inputs.length;
          LABELS[type] = definition.name;
        }
      });
    } catch(err) {
      try { localStorage.removeItem(CUSTOM_CHIPS_STORAGE_KEY); } catch(storageErr) { /* storage unavailable */ }
    }
    renderCustomChips();
  }

  function renderCustomChips(){
    if(!customChipsEl) return;
    customChipsEl.innerHTML = customChips.size ? '<div class="palette-sep"></div><h2>CUSTOM CHIPS</h2>' : '';
    customChips.forEach((definition, type) => {
      const row = document.createElement('div');
      row.className = 'custom-chip-row';
      const button = document.createElement('button');
      button.className = 'part';
      button.dataset.type = type;
      button.innerHTML = `<span class="glyph">▣</span>${definition.name}`;
      const deleteButton = document.createElement('button');
      deleteButton.className = 'custom-chip-delete';
      deleteButton.type = 'button';
      deleteButton.title = `Delete ${definition.name}`;
      deleteButton.textContent = '−';
      deleteButton.addEventListener('click', e => {
        e.stopPropagation();
        deleteCustomChip(type);
      });
      row.appendChild(button);
      row.appendChild(deleteButton);
      customChipsEl.appendChild(row);
      setupPartButton(button);
    });
  }

  function deleteCustomChip(type){
    const definition = customChips.get(type);
    if(!definition) return;
    if(Array.from(nodes.values()).some(node => node.type === type)) {
      toast('Remove placed copies of this chip first');
      return;
    }
    showDeleteConfirmation(definition.name, () => {
      customChips.delete(type);
      delete INPUT_COUNT[type];
      delete LABELS[type];
      persistCustomChips();
      renderCustomChips();
      toast(`Deleted chip: ${definition.name}`);
    });
  }

  function showDeleteConfirmation(name, onDelete){
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
        <div class="confirm-kicker">REMOVE CHIP</div>
        <h3 id="confirmTitle">Delete ${name}?</h3>
        <p>This saved chip will be removed from page storage.</p>
        <div class="confirm-actions">
          <button type="button" class="confirm-cancel">Cancel</button>
          <button type="button" class="confirm-delete">Delete</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.confirm-cancel').addEventListener('click', close);
    overlay.querySelector('.confirm-delete').addEventListener('click', () => {
      close();
      onDelete();
    });
    overlay.addEventListener('click', e => {
      if(e.target === overlay) close();
    });
  }

  function setupPartButton(btn){
    const type = btn.dataset.type;
    btn.setAttribute('draggable', 'true');
    btn.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', type));
    btn.addEventListener('click', () => {
      const x = canvasWrap.scrollLeft / zoom + 60 + (spawnCount % 6) * 40;
      const y = canvasWrap.scrollTop / zoom + 40 + Math.floor(spawnCount / 6) * 90;
      spawnCount++;
      createNode(type, x, y);
      snapshot();
    });
  }

  restoreCustomChips();

  const previewPath = document.createElementNS('http://www.w3.org/2000/svg','path');
  previewPath.setAttribute('class','wire-vis temp');
  previewPath.style.display = 'none';
  wireLayer.appendChild(previewPath);

  function toast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(()=>toastEl.classList.remove('show'), 1600);
  }

  function makeId(prefix){ return prefix + (++nodeSeq); }

  function inputWireKey(nodeId, inputIndex){ return `${nodeId}:${inputIndex}`; }
  function getInputWire(nodeId, inputIndex){ return inputWires.get(inputWireKey(nodeId, inputIndex)); }
  function rebuildWireIndex(){
    inputWires.clear();
    wires.forEach(w => inputWires.set(inputWireKey(w.to, w.toIndex), w));
  }

  function setNodeScale(newScale) {
    nodeScale = Math.max(0.5, Math.min(3.0, newScale));
    nodes.forEach(node => {
      if(node.type !== 'SEVEN' && node.type !== 'FOURTEEN') {
        node.el.style.transformOrigin = 'top left';
        node.el.style.transform = `scale(${nodeScale}) rotate(${node.rotation || 0}deg)`;
      }
    });
    toast(`Node scale: ${Math.round(nodeScale * 100)}%`);
  }

  window.setNodeScale = setNodeScale;

  function rotateNode(node){
    node.rotation = ((node.rotation || 0) + 90) % 360;
    node.el.style.transform = `scale(${nodeScale}) rotate(${node.rotation}deg)`;
    snapshot();
    toast(`Rotated ${node.rotation}°`);
  }

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  document.addEventListener('pointerdown', () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }, { once: true });

  function playTone(node, active) {
    if (active) {
      if (!node.oscillator) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        node.oscillator = audioCtx.createOscillator();
        node.gainNode = audioCtx.createGain();
        node.oscillator.type = 'square';
        node.oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        node.gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        node.oscillator.connect(node.gainNode);
        node.gainNode.connect(audioCtx.destination);
        node.oscillator.start();
      }
    } else if (node.oscillator) {
      node.oscillator.stop();
      node.oscillator.disconnect();
      node.oscillator = null;
      node.gainNode = null;
    }
  }

  function createNode(type, x, y){
    const id = makeId('n');
    const nInputs = INPUT_COUNT[type];
    const el = document.createElement('div');
    el.className = 'node type-' + type;
    el.style.left = x+'px';
    el.style.top = y+'px';
    el.style.transformOrigin = 'top left';
    if(type !== 'SEVEN' && type !== 'FOURTEEN') {
      el.style.transform = `scale(${nodeScale}) rotate(0deg)`;
    }
    el.dataset.id = id;

    const head = document.createElement('div');
    head.className = 'node-head';
    head.innerHTML = `<span>${LABELS[type]}</span>`;
    el.appendChild(head);

    const del = document.createElement('div');
    del.className = 'del';
    del.textContent = '×';
    del.title = 'Delete part';
    del.addEventListener('click', (e)=>{ e.stopPropagation(); removeNode(id); snapshot(); });
    el.appendChild(del);

    const body = document.createElement('div');
    body.className = 'node-body';

    let inPins = [];
    let outPin = null;
    let outPins = [];

    if(type === 'INPUT'){
      const toggle = document.createElement('div');
      toggle.className = 'toggle';
      toggle.innerHTML = '<div class="knob"></div>';
      toggle.addEventListener('click', ()=>{
        node.value = !node.value;
        toggle.classList.toggle('on', node.value);
      });
      body.appendChild(toggle);
      const outWrap = document.createElement('div');
      outWrap.className = 'pins out';
      outPin = document.createElement('div');
      outPin.className = 'pin out';
      outPin.dataset.nodeId = id;
      outPin.dataset.kind = 'out';
      outPin.dataset.index = '0';
      outWrap.appendChild(outPin);
      body.appendChild(outWrap);
    } else if(type === 'OUTPUT'){
      const inWrap = document.createElement('div');
      inWrap.className = 'pins in';
      const p = document.createElement('div');
      p.className = 'pin in'; 
      p.dataset.index = '0';
      p.dataset.nodeId = id;
      p.dataset.kind = 'in';
      inWrap.appendChild(p);
      inPins.push(p);
      body.appendChild(inWrap);
      const led = document.createElement('div');
      led.className = 'led';
      body.appendChild(led);
    } else if(type === 'BUTTON'){
      const btn = document.createElement('div');
      btn.className = 'pushbtn';
      const press = (e)=>{ e.preventDefault(); node.value = true; btn.classList.add('pressed'); };
      const release = ()=>{ node.value = false; btn.classList.remove('pressed'); };
      btn.addEventListener('pointerdown', (e)=>{ e.stopPropagation(); press(e); btn.setPointerCapture(e.pointerId); });
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      body.appendChild(btn);
      const outWrap = document.createElement('div');
      outWrap.className = 'pins out';
      outPin = document.createElement('div');
      outPin.className = 'pin out';
      outPin.dataset.nodeId = id;
      outPin.dataset.kind = 'out';
      outPin.dataset.index = '0';
      outWrap.appendChild(outPin);
      body.appendChild(outWrap);
    } else if(type === 'CLOCK'){
      const widget = document.createElement('div');
      widget.className = 'clk-widget';
      const clockConfig = document.createElement('div');
      clockConfig.className = 'delay-config';
      clockConfig.innerHTML = `
        <select class="delay-select clock-select" data-node-id="${id}">
          <option value="1500" selected>1.5 Sec</option>
          <option value="750">0.75 Sec</option>
          <option value="350">0.35 Sec</option>
        </select>
      `;
      widget.appendChild(clockConfig);
      const led = document.createElement('div');
      led.className = 'led';
      widget.appendChild(led);
      body.appendChild(widget);
      const outWrap = document.createElement('div');
      outWrap.className = 'pins out';
      outPin = document.createElement('div');
      outPin.className = 'pin out';
      outPin.dataset.nodeId = id;
      outPin.dataset.kind = 'out';
      outPin.dataset.index = '0';
      outWrap.appendChild(outPin);
      body.appendChild(outWrap);
        }else if(type === 'OSCLOCK'){
          const alarmWrap = document.createElement('div');
          alarmWrap.className = 'osclock-config';
          const alarmInput = document.createElement('input');
          alarmInput.type = 'datetime-local';
          alarmInput.className = 'osclock-input';
          alarmInput.dataset.nodeId = id;
          alarmInput.title = 'Set alarm date and time';
          const alarmOff = document.createElement('button');
          alarmOff.type = 'button';
          alarmOff.className = 'osclock-off';
          alarmOff.dataset.nodeId = id;
          alarmOff.textContent = 'OFF';
          alarmOff.title = 'Turn off the alarm output';
          alarmWrap.appendChild(alarmInput);
          alarmWrap.appendChild(alarmOff);
          body.appendChild(alarmWrap);

          const stopWrap = document.createElement('div');
          stopWrap.className = 'pins in';
          const stopPin = document.createElement('div');
          stopPin.className = 'pin in';
          stopPin.dataset.index = '0';
          stopPin.dataset.nodeId = id;
          stopPin.dataset.kind = 'in';
          stopWrap.appendChild(stopPin);
          inPins.push(stopPin);
          body.appendChild(stopWrap);

          const outWrap = document.createElement('div');
          outWrap.className = 'pins out';
          const outPinElement = document.createElement('div');
          outPinElement.className = 'pin out';
          outPinElement.dataset.index = '0';
          outPinElement.dataset.nodeId = id;
          outPinElement.dataset.kind = 'out';
          outWrap.appendChild(outPinElement);
          outPins.push(outPinElement);
          body.appendChild(outWrap);

    } else if(isCustomChip(type)) {
      const definition = customChips.get(type);
      const inWrap = document.createElement('div');
      inWrap.className = 'pins in';
      for(let i = 0; i < definition.inputs.length; i++) {
        const pin = document.createElement('div');
        pin.className = 'pin in';
        pin.dataset.index = String(i);
        pin.dataset.nodeId = id;
        pin.dataset.kind = 'in';
        inWrap.appendChild(pin);
        inPins.push(pin);
      }
      body.appendChild(inWrap);
      const outWrap = document.createElement('div');
      outWrap.className = 'pins out';
      for(let i = 0; i < definition.outputs.length; i++) {
        const pin = document.createElement('div');
        pin.className = 'pin out';
        pin.dataset.index = String(i);
        pin.dataset.nodeId = id;
        pin.dataset.kind = 'out';
        outWrap.appendChild(pin);
        outPins.push(pin);
      }
      body.appendChild(outWrap);

    } else if(type === 'SEVEN'){
      const inWrap = document.createElement('div');
      inWrap.className = 'pins in';
      for(let i=0;i<7;i++){
        const p = document.createElement('div');
        p.className = 'pin in'; 
        p.dataset.index = String(i);
        p.dataset.nodeId = id;
        p.dataset.kind = 'in';
        inWrap.appendChild(p);
        inPins.push(p);
      }
      body.appendChild(inWrap);
      const screenContainer = document.createElement('div');
      screenContainer.className = 'display-scale-container';
      
      const screen = document.createElement('div');
      screen.className = 'seven-seg-screen';
      screen.innerHTML = `
        <div class="seg seg-a"></div><div class="seg seg-b"></div>
        <div class="seg seg-c"></div><div class="seg seg-d"></div>
        <div class="seg seg-e"></div><div class="seg seg-f"></div>
        <div class="seg seg-g"></div>
      `;
      screenContainer.appendChild(screen);
      body.appendChild(screenContainer);
    } else if(type === 'FOURTEEN'){
      const inWrap = document.createElement('div');
      inWrap.className = 'pins in';
      for(let i=0;i<14;i++){
        const p = document.createElement('div');
        p.className = 'pin in'; 
        p.dataset.index = String(i);
        p.dataset.nodeId = id;
        p.dataset.kind = 'in';
        inWrap.appendChild(p);
        inPins.push(p);
      }
      body.appendChild(inWrap);
      
      const screenContainer = document.createElement('div');
      screenContainer.className = 'display-scale-container';

      const screen = document.createElement('div');
      screen.className = 'fourteen-seg-screen';
      screen.innerHTML = `
        <div class="fseg fseg-a"></div>
        <div class="fseg fseg-b"></div>
        <div class="fseg fseg-c"></div>
        <div class="fseg fseg-d"></div>
        <div class="fseg fseg-e"></div>
        <div class="fseg fseg-f"></div>
        <div class="fseg fseg-h"></div>
        <div class="fseg fseg-i"></div>
        <div class="fseg fseg-j"></div>
        <div class="fseg fseg-k"></div>
        <div class="fseg fseg-l"></div>
        <div class="fseg fseg-m"></div>
        <div class="fseg fseg-g1"></div>
        <div class="fseg fseg-g2"></div>
      `;
      screenContainer.appendChild(screen);
      body.appendChild(screenContainer);
    } else if(type === 'LCD'){
      const inWrap = document.createElement('div');
      inWrap.className = 'pins in';
      for(let i=0;i<nInputs;i++){
        const p = document.createElement('div');
        p.className = 'pin in'; 
        p.dataset.index = String(i);
        p.dataset.nodeId = id;
        p.dataset.kind = 'in';
        inWrap.appendChild(p);
        inPins.push(p);
      }
      body.appendChild(inWrap);
      const screenContainer = document.createElement('div');
      screenContainer.className = 'display-scale-container';

      const screen = document.createElement('div');
      screen.className = 'lcd-screen';
      screen.textContent = '00';
      screenContainer.appendChild(screen);

      body.appendChild(screenContainer);
    } else if(type === 'JOYSTICK'){
      el.style.position = 'absolute';
      const pad = document.createElement('div');
      pad.className = 'joystick-pad';
      const knob = document.createElement('div');
      knob.className = 'joystick-knob';
      pad.appendChild(knob);
      
      const pinTop = document.createElement('div');
      pinTop.className = 'pin out';
      pinTop.style.position = 'absolute';
      pinTop.style.top = '-6px';
      pinTop.style.left = '50%';
      pinTop.style.transform = 'translateX(-50%)';
      pinTop.dataset.nodeId = id;
      pinTop.dataset.kind = 'out';
      pinTop.dataset.index = '0';
      el.appendChild(pinTop);
      outPins.push(pinTop);

      const pinBottom = document.createElement('div');
      pinBottom.className = 'pin out';
      pinBottom.style.position = 'absolute';
      pinBottom.style.bottom = '-6px';
      pinBottom.style.left = '50%';
      pinBottom.style.transform = 'translateX(-50%)';
      pinBottom.dataset.nodeId = id;
      pinBottom.dataset.kind = 'out';
      pinBottom.dataset.index = '1';
      el.appendChild(pinBottom);
      outPins.push(pinBottom);

      const pinLeft = document.createElement('div');
      pinLeft.className = 'pin out';
      pinLeft.style.position = 'absolute';
      pinLeft.style.left = '-6px';
      pinLeft.style.top = '50%';
      pinLeft.style.transform = 'translateY(-50%)';
      pinLeft.dataset.nodeId = id;
      pinLeft.dataset.kind = 'out';
      pinLeft.dataset.index = '2';
      el.appendChild(pinLeft);
      outPins.push(pinLeft);

      const pinRight = document.createElement('div');
      pinRight.className = 'pin out';
      pinRight.style.position = 'absolute';
      pinRight.style.right = '-3px';
      pinRight.style.top = '50%';
      pinRight.style.transform = 'translateY(-50%)';
      pinRight.dataset.nodeId = id;
      pinRight.dataset.kind = 'out';
      pinRight.dataset.index = '3';
      el.appendChild(pinRight);
      outPins.push(pinRight);

      body.appendChild(pad);

      let isDraggingJoy = false;
      pad.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        isDraggingJoy = true;
        pad.setPointerCapture(e.pointerId);
      });
      pad.addEventListener('pointermove', (e) => {
        if(!isDraggingJoy) return;
        const rect = pad.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        let dx = e.clientX - centerX;
        let dy = e.clientY - centerY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const maxRadius = 30; 
        if(dist > maxRadius) {
          dx = (dx / dist) * maxRadius;
          dy = (dy / dist) * maxRadius;
        }
        node.knobX = dx;
        node.knobY = dy;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      const endJoy = (e) => {
        if(!isDraggingJoy) return;
        isDraggingJoy = false;
        node.knobX = 0;
        node.knobY = 0;
        knob.style.transform = `translate(0px, 0px)`;
      };
      pad.addEventListener('pointerup', endJoy);
      pad.addEventListener('pointercancel', endJoy);
    } else if(type === 'SPEAKER'){
      const inWrap = document.createElement('div');
      inWrap.className = 'pins in';
      const p = document.createElement('div');
      p.className = 'pin in'; 
      p.dataset.index = '0';
      p.dataset.nodeId = id;
      p.dataset.kind = 'in';
      inWrap.appendChild(p);
      inPins.push(p);
      body.appendChild(inWrap);

      const speakerIcon = document.createElement('div');
      speakerIcon.className = 'speaker-icon';
      speakerIcon.textContent = '🔊';
      speakerIcon.style.margin = '0 auto';
      speakerIcon.style.fontSize = '20px';
      body.appendChild(speakerIcon);
    } else {
      const inWrap = document.createElement('div');
      inWrap.className = 'pins in';
      for(let i=0;i<nInputs;i++){
        const p = document.createElement('div');
        p.className = 'pin in'; 
        p.dataset.index = String(i);
        p.dataset.nodeId = id;
        p.dataset.kind = 'in';
        inWrap.appendChild(p);
        inPins.push(p);
      }
      body.appendChild(inWrap);
      
      if (type === 'DELAY') {
        const currentTicks = 1;
        const configWrap = document.createElement('div');
        configWrap.className = 'delay-config';
        configWrap.innerHTML = `
          <select class="delay-select" data-node-id="${id}">
            <option value="1" ${currentTicks === 1 ? 'selected' : ''}>1 Tick (16ms)</option>
            <option value="2" ${currentTicks === 2 ? 'selected' : ''}>2 Ticks (~32ms)</option>
            <option value="5" ${currentTicks === 5 ? 'selected' : ''}>5 Ticks (~80ms)</option>
            <option value="10" ${currentTicks === 10 ? 'selected' : ''}>10 Ticks (~160ms)</option>
            <option value="15" ${currentTicks === 15 ? 'selected' : ''}>15 Ticks (~240ms)</option>
            <option value="20" ${currentTicks === 20 ? 'selected' : ''}>20 Ticks (~320ms)</option>
            <option value="40" ${currentTicks === 40 ? 'selected' : ''}>40 Ticks (~640ms)</option>
            <option value="60" ${currentTicks === 60 ? 'selected' : ''}>60 Ticks (~1 Sec)</option>
            <option value="120" ${currentTicks === 120 ? 'selected' : ''}>120 Ticks (~2 Sec)</option>
            <option value="600" ${currentTicks === 600 ? 'selected' : ''}>600 Ticks (~10 Sec)</option>
            <option value="3600" ${currentTicks === 3600 ? 'selected' : ''}>3600 Ticks (1 Min)</option>
          </select>
        `;
        body.appendChild(configWrap);
      }
      const outWrap = document.createElement('div');
      outWrap.className = 'pins out';
      outPin = document.createElement('div');
      outPin.className = 'pin out';
      outPin.dataset.nodeId = id;
      outPin.dataset.kind = 'out';
      outPin.dataset.index = '0';
      outWrap.appendChild(outPin);
      body.appendChild(outWrap);

      if(type === 'CALCULATOR') {
        const opBtn = document.createElement('div');
        opBtn.style.textAlign = 'center';
        opBtn.style.cursor = 'pointer';
        opBtn.style.fontSize = '12px';
        opBtn.style.padding = '2px';
        opBtn.textContent = 'Op: +';
        opBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const ops = ['+', '-', '*', '/', '^'];
          const idx = (ops.indexOf(node.operation || '+') + 1) % ops.length;
          node.operation = ops[idx];
          opBtn.textContent = 'Op: ' + node.operation;
        });
        body.appendChild(opBtn);
        node.operation = '+';
      }
    }

    el.appendChild(body);
    canvasInner.appendChild(el);

    const node = {
      id, type, x, y, value:false,
      el, inPins, outPin, outPins, led: el.querySelector('.led'), lcdDisplay: el.querySelector('.lcd-screen, .seven-seg-screen, .fourteen-seg-screen'),
      nInputs, period:1500, startTime:Date.now(),
      knobX: 0, knobY: 0, operation: '+', history: [], delayTicks: 1, buffer: [false],
      osTargetTime: null, osAlarmTriggered: false, osAlarmStopped: false, rotation: 0
    };
    nodes.set(id, node);

    el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.pin, button, input, select, .del, .pushbtn, .toggle, .osclock-off')) return;
      e.stopPropagation();
      duplicateNode(node);
    });

    attachDrag(node, head);
    
    inPins.forEach((p, idx) => {
      p.addEventListener('pointerdown', (e) => onPinPointerDown(node, 'in', idx, p, e));
      p.addEventListener('pointerup', (e) => onPinPointerUp(node, 'in', idx, p, e));
    });
    
    if(node.outPin) {
      node.outPin.addEventListener('pointerdown', (e) => onPinPointerDown(node, 'out', 0, node.outPin, e));
      node.outPin.addEventListener('pointerup', (e) => onPinPointerUp(node, 'out', 0, node.outPin, e));
    }

    if(node.outPins && node.outPins.length > 0) {
      node.outPins.forEach((p, idx) => {
        p.addEventListener('pointerdown', (e) => onPinPointerDown(node, 'out', idx, p, e));
        p.addEventListener('pointerup', (e) => onPinPointerUp(node, 'out', idx, p, e));
      });
    }

    return node;
  }

  function duplicateNode(source){
    const duplicate = createNode(source.type, source.x + 40, source.y + 40);
    duplicate.value = source.value;
    duplicate.period = source.period;
    duplicate.delayTicks = source.delayTicks;
    duplicate.buffer = source.buffer ? [...source.buffer] : [false];
    duplicate.operation = source.operation;
    duplicate.rotation = source.rotation || 0;
    duplicate.osTargetTime = source.osTargetTime;
    duplicate.osAlarmTriggered = source.osAlarmTriggered;
    duplicate.osAlarmStopped = source.osAlarmStopped;

    const inputToggle = duplicate.el.querySelector('.toggle');
    if(inputToggle) inputToggle.classList.toggle('on', duplicate.value);
    const clockSelect = duplicate.el.querySelector('.clock-select');
    if(clockSelect) clockSelect.value = duplicate.period;
    const delaySelect = duplicate.el.querySelector('.delay-select');
    if(delaySelect) delaySelect.value = duplicate.delayTicks;
    const alarmInput = duplicate.el.querySelector('.osclock-input');
    if(alarmInput && duplicate.osTargetTime) {
      const date = new Date(duplicate.osTargetTime);
      const pad = value => String(value).padStart(2, '0');
      alarmInput.value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
    duplicate.el.style.transform = `scale(${nodeScale}) rotate(${duplicate.rotation}deg)`;
    snapshot();
    toast('Component duplicated');
    return duplicate;
  }

  canvasInner.addEventListener('change', (e) => {
    if (e.target.classList.contains('osclock-input')) {
      const node = nodes.get(e.target.getAttribute('data-node-id'));
      if (node) {
        node.osTargetTime = e.target.value ? new Date(e.target.value).getTime() : null;
        node.osAlarmTriggered = false;
        node.osAlarmStopped = false;
        node.value = false;
        snapshot();
      }
      return;
    }
    if (e.target.classList.contains('delay-select')) {
      const nodeId = e.target.getAttribute('data-node-id');
      const node = nodes.get(nodeId);
      if (node) {
        if (node.type === 'CLOCK') {
          node.period = parseInt(e.target.value, 10);
          node.startTime = Date.now();
        } else {
          node.delayTicks = parseInt(e.target.value, 10);
          node.buffer = new Array(node.delayTicks).fill(false);
        }
        snapshot();
      }
    }
  });

  canvasInner.addEventListener('click', (e) => {
    if (!e.target.classList.contains('osclock-off')) return;
    const node = nodes.get(e.target.getAttribute('data-node-id'));
    if (node) {
      node.value = false;
      node.osAlarmTriggered = true;
      node.osAlarmStopped = true;
      snapshot();
    }
  });

  function onPinPointerDown(node, kind, index, pinEl, e) {
    e.stopPropagation();
    pendingWireFrom = { nodeId: node.id, kind, index };
    pinEl.classList.add('hot');
    canvasWrap.setPointerCapture(e.pointerId);
  }

  function onPinPointerUp(node, kind, index, pinEl, e) {
    e.stopPropagation();
    if (!pendingWireFrom) return;
    
    const targetEl = document.elementFromPoint(e.clientX, e.clientY);
    const targetPin = targetEl ? targetEl.closest('.pin') : null;

    if (targetPin && targetPin.dataset.nodeId) {
      const targetNodeId = targetPin.dataset.nodeId;
      const targetKind = targetPin.dataset.kind;
      const targetIndex = parseInt(targetPin.dataset.index || '0', 10);

      if (pendingWireFrom.kind !== targetKind && pendingWireFrom.nodeId !== targetNodeId) {
        let fromId, toId, toIndex, fromIndex = 0;
        if (pendingWireFrom.kind === 'out') {
          fromId = pendingWireFrom.nodeId;
          fromIndex = pendingWireFrom.index;
          toId = targetNodeId;
          toIndex = targetIndex;
        } else {
          toId = pendingWireFrom.nodeId;
          toIndex = pendingWireFrom.index;
          fromId = targetNodeId;
          fromIndex = targetIndex;
        }
        
        createWire(fromId, toId, toIndex, fromIndex);
        toast('Wire connected');
        snapshot();
      }
    }
    cancelPendingWire();
  }

  function cancelPendingWire(){
    if(pendingWireFrom){
      const n = nodes.get(pendingWireFrom.nodeId);
      if(n) {
        if(pendingWireFrom.kind === 'out') {
          if(n.outPin) n.outPin.classList.remove('hot');
          if(n.outPins && n.outPins[pendingWireFrom.index]) n.outPins[pendingWireFrom.index].classList.remove('hot');
        }
        if(pendingWireFrom.kind === 'in' && n.inPins[pendingWireFrom.index]) n.inPins[pendingWireFrom.index].classList.remove('hot');
      }
    }
    pendingWireFrom = null;
    previewPath.style.display = 'none';
  }

  function removeNode(id){
    const node = nodes.get(id);
    if(!node) return;
    wires = wires.filter(w=>{
      if(w.from===id || w.to===id){ w.elVis.remove(); w.elHit.remove(); return false; }
      return true;
    });
    rebuildWireIndex();
    node.el.remove();
    nodes.delete(id);
    selectedNodeIds.delete(id);
  }

  function removeWire(wireId){
    const idx = wires.findIndex(w=>w.id===wireId);
    if(idx===-1) return;
    wires[idx].elVis.remove();
    wires[idx].elHit.remove();
    wires.splice(idx,1);
    rebuildWireIndex();
  }

  function createWire(fromId, toId, toIndex, fromIndex = 0){
    wires = wires.filter(w=>{
      if(w.to===toId && w.toIndex===toIndex){ w.elVis.remove(); w.elHit.remove(); return false; }
      return true;
    });
    const id = 'w'+(++wireSeq);
    const elHit = document.createElementNS('http://www.w3.org/2000/svg','path');
    elHit.setAttribute('class','wire-hit');
    elHit.addEventListener('click', ()=> { removeWire(id); snapshot(); });
    const elVis = document.createElementNS('http://www.w3.org/2000/svg','path');
    elVis.setAttribute('class','wire-vis');
    wireLayer.appendChild(elVis);
    wireLayer.appendChild(elHit);
    wires.push({ id, from:fromId, to:toId, toIndex, fromIndex, elVis, elHit });
    rebuildWireIndex();
  }

  canvasWrap.addEventListener('click', (e)=>{
    if(e.target === canvasWrap || e.target === canvasInner || e.target === zoomStage){
      cancelPendingWire();
      if(!e.shiftKey) {
        selectedNodeIds.clear();
        nodes.forEach(n => n.el.classList.remove('selected'));
      }
    }
  });

  let panState = null;
  canvasWrap.addEventListener('pointerdown', (e)=>{
    if (pendingWireFrom) return;
    if(e.target !== canvasWrap && e.target !== canvasInner && e.target !== zoomStage) return;
    if(e.button !== 0 && e.button !== 1) return;

    const cr = canvasInner.getBoundingClientRect();
    const cx = (e.clientX - cr.left) / zoom;
    const cy = (e.clientY - cr.top) / zoom;

    if (e.shiftKey && e.button === 0) {
      isSelecting = true;
      selectStart = { x: cx, y: cy };
      selectionBox.style.left = cx + 'px';
      selectionBox.style.top = cy + 'px';
      selectionBox.style.width = '0px';
      selectionBox.style.height = '0px';
      selectionBox.style.display = 'block';
      canvasWrap.setPointerCapture(e.pointerId);
    } else {
      panState = { x:e.clientX, y:e.clientY, sl:canvasWrap.scrollLeft, st:canvasWrap.scrollTop };
      canvasWrap.classList.add('panning');
      canvasWrap.setPointerCapture(e.pointerId);
    }
  });

  canvasWrap.addEventListener('pointermove', (e)=>{
    const cr = canvasInner.getBoundingClientRect();
    mousePos.x = (e.clientX - cr.left) / zoom;
    mousePos.y = (e.clientY - cr.top) / zoom;
    
    if (pendingWireFrom) {
      const node = nodes.get(pendingWireFrom.nodeId);
      const pinEl = pendingWireFrom.kind === 'out' 
        ? (node.outPin || (node.outPins && node.outPins[pendingWireFrom.index])) 
        : node.inPins[pendingWireFrom.index];

      if (pinEl) {
        const pinCoord = pinCenter(pinEl);
        const a = pendingWireFrom.kind === 'out' ? pinCoord : mousePos;
        const b = pendingWireFrom.kind === 'out' ? mousePos : pinCoord;
        previewPath.setAttribute('d', bezierPath(a, b));
        previewPath.style.display = 'block';
      }
      return;
    }

    if (isSelecting) {
      const x1 = Math.min(selectStart.x, mousePos.x);
      const y1 = Math.min(selectStart.y, mousePos.y);
      const x2 = Math.max(selectStart.x, mousePos.x);
      const y2 = Math.max(selectStart.y, mousePos.y);

      selectionBox.style.left = x1 + 'px';
      selectionBox.style.top = y1 + 'px';
      selectionBox.style.width = (x2 - x1) + 'px';
      selectionBox.style.height = (y2 - y1) + 'px';
      return;
    }

    if(!panState) return;
    canvasWrap.scrollLeft = panState.sl - (e.clientX - panState.x);
    canvasWrap.scrollTop  = panState.st - (e.clientY - panState.y);
  });

  function endPanOrSelect(e){
    if (pendingWireFrom) {
      const targetEl = document.elementFromPoint(e.clientX, e.clientY);
      const targetPin = targetEl ? targetEl.closest('.pin') : null;
      
      if (targetPin && targetPin.dataset.nodeId) {
        const targetNodeId = targetPin.dataset.nodeId;
        const targetKind = targetPin.dataset.kind;
        const targetIndex = parseInt(targetPin.dataset.index || '0', 10);

        if (pendingWireFrom.kind !== targetKind && pendingWireFrom.nodeId !== targetNodeId) {
          let fromId, toId, toIndex, fromIndex = 0;
          if (pendingWireFrom.kind === 'out') {
            fromId = pendingWireFrom.nodeId;
            fromIndex = pendingWireFrom.index;
            toId = targetNodeId;
            toIndex = targetIndex;
          } else {
            toId = pendingWireFrom.nodeId;
            toIndex = pendingWireFrom.index;
            fromId = targetNodeId;
            fromIndex = targetIndex;
          }
          createWire(fromId, toId, toIndex, fromIndex);
          toast('Wire connected');
          snapshot();
        }
      }
      cancelPendingWire();
    }

    if (isSelecting) {
      isSelecting = false;
      selectionBox.style.display = 'none';

      const x1 = Math.min(selectStart.x, mousePos.x);
      const y1 = Math.min(selectStart.y, mousePos.y);
      const x2 = Math.max(selectStart.x, mousePos.x);
      const y2 = Math.max(selectStart.y, mousePos.y);

      if (!e.shiftKey) {
        selectedNodeIds.clear();
      }

      nodes.forEach((node, id)=>{
        const nodeW = node.el.offsetWidth * nodeScale;
        const nodeH = node.el.offsetHeight * nodeScale;
        if (node.x < x2 && node.x + nodeW > x1 && node.y < y2 && node.y + nodeH > y1) {
          selectedNodeIds.add(id);
          node.el.classList.add('selected');
        } else if (!e.shiftKey) {
          node.el.classList.remove('selected');
        }
      });
    }

    if(!panState) return;
    panState = null;
    canvasWrap.classList.remove('panning');
  }

  canvasWrap.addEventListener('pointerup', endPanOrSelect);
  canvasWrap.addEventListener('pointercancel', endPanOrSelect);

  const BASE_W = 2400, BASE_H = 1500, ZOOM_MIN = 0.35, ZOOM_MAX = 2.2;
  let zoom = 1;
  const zoomLabel = document.getElementById('zoomLabel');

  function applyZoom(nextZoom, anchorX, anchorY){
    nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextZoom));
    const wrapRect = canvasWrap.getBoundingClientRect();
    const ax = anchorX - wrapRect.left, ay = anchorY - wrapRect.top;
    const baseX = (canvasWrap.scrollLeft + ax) / zoom;
    const baseY = (canvasWrap.scrollTop + ay) / zoom;
    zoom = nextZoom;
    zoomStage.style.width  = (BASE_W*zoom)+'px';
    zoomStage.style.height = (BASE_H*zoom)+'px';
    canvasInner.style.transform = `scale(${zoom})`;
    canvasWrap.scrollLeft = baseX*zoom - ax;
    canvasWrap.scrollTop  = baseY*zoom - ay;
    if(zoomLabel) zoomLabel.textContent = Math.round(zoom*100)+'%';
  }

  canvasWrap.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    applyZoom(zoom*factor, e.clientX, e.clientY);
  }, { passive:false });

  document.getElementById('zoomReset')?.addEventListener('click', ()=>{
    const wrapRect = canvasWrap.getBoundingClientRect();
    applyZoom(1, wrapRect.left+wrapRect.width/2, wrapRect.top+wrapRect.height/2);
  });

  function attachDrag(node, handle){
    let sx=0, sy=0, dragging=false;
    let initialPositions = new Map();

    handle.addEventListener('pointerdown', (e)=>{
      e.stopPropagation();
      if (!selectedNodeIds.has(node.id)) {
        if (!e.shiftKey) {
          selectedNodeIds.clear();
          nodes.forEach(n => n.el.classList.remove('selected'));
        }
        selectedNodeIds.add(node.id);
        node.el.classList.add('selected');
      }

      dragging = true;
      sx = e.clientX; sy = e.clientY;
      initialPositions.clear();
      selectedNodeIds.forEach(id=>{
        const n = nodes.get(id);
        if(n){
          n.el.classList.add('dragging');
          initialPositions.set(id, { x: n.x, y: n.y });
        }
      });
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e)=>{
      if(!dragging) return;
      const dx = (e.clientX - sx)/zoom;
      const dy = (e.clientY - sy)/zoom;

      selectedNodeIds.forEach(id=>{
        const n = nodes.get(id);
        const init = initialPositions.get(id);
        if(n && init){
          n.x = Math.max(0, init.x + dx);
          n.y = Math.max(0, init.y + dy);
          n.el.style.left = n.x + 'px';
          n.el.style.top = n.y + 'px';
        }
      });
    });

    function end(e){
      if(!dragging) return;
      dragging = false;
      selectedNodeIds.forEach(id=>{
        const n = nodes.get(id);
        if(n) n.el.classList.remove('dragging');
      });
      snapshot();
    }
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  window.addEventListener('keydown', (e)=>{
    const inField = document.activeElement && document.activeElement.tagName === 'INPUT';
    if(inField) return;

    if(e.key === 'Delete' || e.key === 'Backspace'){
      if(selectedNodeIds.size > 0){
        const idsToDelete = Array.from(selectedNodeIds);
        idsToDelete.forEach(id => removeNode(id));
        selectedNodeIds.clear();
        toast('Deleted selected parts');
        snapshot();
      }
      return;
    }

    const mod = e.ctrlKey || e.metaKey;
    if(!mod && e.key.toLowerCase() === 'r' && selectedNodeIds.size > 0){
      e.preventDefault();
      selectedNodeIds.forEach(id => {
        const node = nodes.get(id);
        if(node) rotateNode(node);
      });
      return;
    }
    if(!mod) return;
    const key = e.key.toLowerCase();
    if(key === 'c'){ e.preventDefault(); copySelection(); }
    else if(key === 'v'){ e.preventDefault(); pasteClipboard(); }
    else if(key === 'z'){ e.preventDefault(); undo(); }
    else if(key === 'y'){ e.preventDefault(); redo(); }
  });

  let spawnCount = 0;
  document.querySelectorAll('.part').forEach(btn=>{
    setupPartButton(btn);
  });

  canvasWrap.addEventListener('dragover', (e)=>{
    e.preventDefault();
  });

  canvasWrap.addEventListener('drop', (e)=>{
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain');
    if(!type || INPUT_COUNT[type] === undefined) return;
    const cr = canvasInner.getBoundingClientRect();
    const x = (e.clientX - cr.left) / zoom - 50;
    const y = (e.clientY - cr.top) / zoom - 20;
    createNode(type, Math.max(0, x), Math.max(0, y));
    snapshot();
  });

  function pinCenter(pinEl){
    const pr = pinEl.getBoundingClientRect();
    const cr = canvasInner.getBoundingClientRect();
    return { 
      x: (pr.left + pr.width / 2 - cr.left) / zoom, 
      y: (pr.top + pr.height / 2 - cr.top) / zoom 
    };
  }

  function bezierPath(a,b){
    const dx = Math.max(40, Math.abs(b.x-a.x)*0.5);
    return `M ${a.x} ${a.y} C ${a.x+dx} ${a.y}, ${b.x-dx} ${b.y}, ${b.x} ${b.y}`;
  }

  function evaluateChip(node, inputs){
    const definition = customChips.get(node.type);
    if(!definition) return [];
    if(!definition.evalOrder) {
      const byId = new Map(definition.nodes.map(inner => [inner.id, inner]));
      const indegree = new Map(definition.nodes.map(inner => [inner.id, 0]));
      const dependents = new Map(definition.nodes.map(inner => [inner.id, []]));
      definition.wires.forEach(wire => {
        if(byId.has(wire.from) && byId.has(wire.to)) {
          indegree.set(wire.to, indegree.get(wire.to) + 1);
          dependents.get(wire.from).push(wire.to);
        }
      });
      const ready = definition.nodes.filter(inner => indegree.get(inner.id) === 0).map(inner => inner.id);
      const order = [];
      while(ready.length) {
        const id = ready.shift();
        order.push(byId.get(id));
        dependents.get(id).forEach(nextId => {
          indegree.set(nextId, indegree.get(nextId) - 1);
          if(indegree.get(nextId) === 0) ready.push(nextId);
        });
      }
      definition.nodes.forEach(inner => { if(!order.includes(inner)) order.push(inner); });
      definition.evalOrder = order;
    }
    const values = new Map();
    definition.nodes.forEach(inner => {
      values.set(inner.id, inner.type === 'INPUT' ? !!inputs[definition.inputs.indexOf(inner.id)] : !!inner.value);
    });
    const sourceValue = wire => {
      if(!wire) return false;
      const indexedValue = values.get(`${wire.from}:${wire.fromIndex || 0}`);
      return indexedValue !== undefined ? !!indexedValue : !!values.get(wire.from);
    };
    definition.evalOrder.forEach(inner => {
        if(inner.type === 'INPUT' || inner.type === 'OUTPUT') return;
        const vals = [];
        for(let i = 0; i < (INPUT_COUNT[inner.type] || 0); i++) {
          vals.push(sourceValue(definition.wires.find(w => w.to === inner.id && w.toIndex === i)));
        }
        let out = false;
        if(inner.type === 'AND') out = vals[0] && vals[1];
        else if(inner.type === 'OR') out = vals[0] || vals[1];
        else if(inner.type === 'NAND') out = !(vals[0] && vals[1]);
        else if(inner.type === 'NOR') out = !(vals[0] || vals[1]);
        else if(inner.type === 'XOR') out = !!vals[0] !== !!vals[1];
        else if(inner.type === 'XNOR') out = !!vals[0] === !!vals[1];
        else if(inner.type === 'NOT') out = !vals[0];
        else if(inner.type === 'MEMORY') out = vals[1] ? false : (vals[0] || !!inner.value);
        else if(inner.type === 'DELAY') out = vals[0];
        else if(inner.type === 'CALCULATOR') out = Number(vals[0]) + Number(vals[1]);
        else if(inner.type === 'GREATER') out = Number(vals[0]) > Number(vals[1]);
        else if(inner.type === 'XAND') out = !vals[0] && !vals[1] ? 10 : vals[0] && vals[1];
        else if(isCustomChip(inner.type)) {
          const chipOutputs = evaluateChip(inner, vals);
          chipOutputs.forEach((value, index) => values.set(`${inner.id}:${index}`, value));
          out = chipOutputs[0] || false;
        }
        values.set(inner.id, out);
    });
    return definition.outputs.map(outputId => sourceValue(definition.wires.find(w => w.to === outputId && w.toIndex === 0)));
  }

  function updateCustomChip(node){
    const previousOutputs = node.outValues ? [...node.outValues] : [];
    const inputs = [];
    for(let i = 0; i < node.nInputs; i++) {
      const wire = getInputWire(node.id, i);
      const source = wire ? nodes.get(wire.from) : null;
      if(!source) {
        inputs.push(false);
      } else if(source.type === 'JOYSTICK' && source.outValues) {
        inputs.push(!!source.outValues[wire.fromIndex || 0]);
      } else if(isCustomChip(source.type) && source.outValues) {
        inputs.push(!!source.outValues[wire.fromIndex || 0]);
      } else {
        inputs.push(!!source.value);
      }
    }
    node.outValues = evaluateChip(node, inputs);
    node.value = !!node.outValues[0];
    return previousOutputs.length !== node.outValues.length || node.outValues.some((value, index) => value !== previousOutputs[index]);
  }

  function simulate(){
    nodes.forEach(node=>{
      if(node.type === 'INPUT' || node.type === 'BUTTON') return;
      if(node.type === 'CLOCK'){
        node.value = Math.floor((Date.now()-node.startTime)/node.period) % 2 === 0;
        return;
      }

      if(node.type === 'OSCLOCK'){
        const stopWire = getInputWire(node.id, 0);
        const stopNode = stopWire ? nodes.get(stopWire.from) : null;
        if (stopNode && stopNode.value) {
          node.value = false;
          node.osAlarmTriggered = true;
          node.osAlarmStopped = true;
          return;
        }
        if (node.osTargetTime && !node.osAlarmTriggered && Date.now() >= node.osTargetTime) {
          node.osAlarmTriggered = true;
        }
        node.value = node.osAlarmTriggered && !node.osAlarmStopped && Math.floor(Date.now() / 500) % 2 === 0;
        return;
      }
 
      if(node.type === 'JOYSTICK'){
        const normX = (node.knobX || 0) / 20;
        const normY = (node.knobY || 0) / 20;
        
        let up = false, down = false, left = false, right = false;
        if (Math.abs(normX) > 0.08 || Math.abs(normY) > 0.08) {
          if (Math.abs(normY) > Math.abs(normX)) {
            if (normY < 0) up = true;
            else down = true;
          } else {
            if (normX < 0) left = true;
            else right = true;
          }
        }

        node.outValues = { up, down, left, right };
        node.value = up || down || left || right;
        return;
      }

      if(isCustomChip(node.type)) {
        updateCustomChip(node);
        return;
      }

      const vals = [];
      for(let i=0;i<node.nInputs;i++){
        const w = getInputWire(node.id, i);
        let v = false;
        if(w){
          const src = nodes.get(w.from);
          if(src && src.type === 'JOYSTICK' && src.outValues){
            const keys = ['up', 'down', 'left', 'right'];
            v = !!src.outValues[keys[w.fromIndex || 0]];
          } else if(src && src.outValues && isCustomChip(src.type)) {
            v = !!src.outValues[w.fromIndex || 0];
          } else {
            v = src ? (src.value || false) : false;
          }
        }
        vals.push(v);
      }

      let out;
      switch(node.type){
        case 'AND':  out = vals[0] && vals[1]; break;
        case 'OR':   out = vals[0] || vals[1]; break;
        case 'NAND': out = !(vals[0] && vals[1]); break;
        case 'NOR':  out = !(vals[0] || vals[1]); break;
        case 'XOR':  out = !!vals[0] !== !!vals[1]; break;
        case 'XNOR': out = !!vals[0] === !!vals[1]; break;
        case 'NOT':  out = !vals[0]; break;
        case 'MEMORY': out = vals[1] ? false : (vals[0] ? true : node.value); break;
        case 'OUTPUT': out = vals[0]; break;
        case 'SPEAKER':
          out = !!vals[0];
          playTone(node, out);
          break;
        case 'LCD':  out = (vals[0]?8:0) + (vals[1]?4:0) + (vals[2]?2:0) + (vals[3]?1:0); break;
        case 'DELAY':
          if (!node.buffer || node.buffer.length !== (node.delayTicks || 1)) {
            const ticks = node.delayTicks || 1;
            node.buffer = new Array(ticks).fill(false);
          }
          node.buffer.push(vals[0]);
          out = node.buffer.shift();
          break;
        case 'CALCULATOR': {
          const v0 = Number(vals[0]) || 0;
          const v1 = Number(vals[1]) || 0;
          const op = node.operation || '+';
          if(op === '+') out = v0 + v1;
          else if(op === '-') out = Math.max(0, v0 - v1);
          else if(op === '*') out = v0 * v1;
          else if(op === '/') out = v1 !== 0 ? v0 / v1 : 0;
          else if(op === '^') out = Math.pow(v0, v1);
          break;
        }
        case 'GREATER':
          out = (Number(vals[0]) > Number(vals[1])) ? vals[0] : 0;
          break;
        case 'XAND':
          out = (Number(vals[0]) === 0 && Number(vals[1]) === 0) ? 10.0 : (vals[0] && vals[1]);
          break;
        case 'SEVEN':
        case 'FOURTEEN': {
          out = [];
          for(let i=0; i<node.nInputs; i++){
            out.push(!!vals[i]);
          }
          break;
        }
        default: out = false;
      }
      node.value = out;
    });

    nodes.forEach(node=>{
      if(node.outPin) node.outPin.classList.toggle('hot', !!node.value);
      if(node.outPins && node.outPins.length > 0) {
        node.outPins.forEach((p, idx) => {
          const keys = ['up', 'down', 'left', 'right'];
          const val = isCustomChip(node.type)
            ? !!(node.outValues && node.outValues[idx])
            : (node.outValues ? node.outValues[keys[idx]] : false);
          p.classList.toggle('hot', !!val);
        });
      }
      if(node.led) node.led.classList.toggle('on', !!node.value);
      if(node.lcdDisplay && node.type !== 'OSCLOCK') {
        
        if(node.type === 'SEVEN' && Array.isArray(node.value)) {
          const segs = node.lcdDisplay.querySelectorAll('.seg');
          segs.forEach((seg, idx)=>{
            seg.classList.toggle('lit', node.value[idx]);
          });
        } else if(node.type === 'FOURTEEN' && Array.isArray(node.value)) {
          const segs = node.lcdDisplay.querySelectorAll('.fseg');
          segs.forEach((seg, idx)=>{
            seg.classList.toggle('lit', node.value[idx]);
          });
        } else {
          node.lcdDisplay.textContent = String(node.value).padStart(2,'0');
        }
      }
      if(node.type==='INPUT' || node.type==='BUTTON'){
        const toggle = node.el.querySelector('.toggle');
        if(toggle) toggle.classList.toggle('on', node.value);
      }
      node.inPins.forEach((p,i)=>{
        const w = getInputWire(node.id, i);
        let v = false;
        if (w) {
          const src = nodes.get(w.from);
          if (src && src.type === 'JOYSTICK' && src.outValues) {
            const keys = ['up', 'down', 'left', 'right'];
            v = !!src.outValues[keys[w.fromIndex || 0]];
          } else if (src && src.outValues && isCustomChip(src.type)) {
            v = !!src.outValues[w.fromIndex || 0];
          } else {
            v = src ? (src.value || false) : false;
          }
        }
        p.classList.toggle('hot', v);
      });
    });
    const customNodes = Array.from(nodes.values()).filter(node => isCustomChip(node.type));
    for(let pass = 0; pass < customNodes.length; pass++) {
      let changed = false;
      customNodes.forEach(node => { if(updateCustomChip(node)) changed = true; });
      if(!changed) break;
    }
  }

  function renderWires(){
    wires.forEach(w => {
      const from = nodes.get(w.from), to = nodes.get(w.to);
      if(!from || !to) return;
      
      let fromPin = from.outPin;
      if(!fromPin && from.outPins && typeof w.fromIndex === 'number') {
        fromPin = from.outPins[w.fromIndex];
      }
      if(!fromPin && from.outPins && from.outPins.length > 0) {
        fromPin = from.outPins[0];
      }
      if(!fromPin || !to.inPins[w.toIndex]) return;

      const a = pinCenter(fromPin);
      const b = pinCenter(to.inPins[w.toIndex]);
      const d = bezierPath(a, b);
      w.elVis.setAttribute('d', d);
      w.elHit.setAttribute('d', d);
      
      let isHot = !!from.value;
      if(from.type === 'JOYSTICK' && from.outValues && typeof w.fromIndex === 'number') {
        const keys = ['up', 'down', 'left', 'right'];
        isHot = !!from.outValues[keys[w.fromIndex]];
      } else if(isCustomChip(from.type) && from.outValues && typeof w.fromIndex === 'number') {
        isHot = !!from.outValues[w.fromIndex];
      }
      w.elVis.classList.toggle('hot', isHot);
    });
  }

  function loop(){
    simulate();
    renderWires();
    requestAnimationFrame(loop);
  }
  loop();

  function clearBoard(){
    wires.forEach(w=>{ w.elVis.remove(); w.elHit.remove(); });
    wires = [];
    inputWires.clear();
    nodes.forEach(n=>n.el.remove());
    nodes.clear();
    selectedNodeIds.clear();
    pendingWireFrom = null;
    spawnCount = 0;
  }
  document.getElementById('clearAll').addEventListener('click', ()=>{ clearBoard(); snapshot(); toast('Board cleared'); });

  function serializeBoard(){
    return {
      version: 1,
      customChips: Object.fromEntries(customChips),
      nodes: Array.from(nodes.values()).map(n=>({
        id: n.id, type: n.type, x: n.x, y: n.y,
        rotation: n.rotation || 0,
        value: n.type === 'INPUT' ? !!n.value : undefined,
        period: n.type === 'CLOCK' ? n.period : undefined,
        delayTicks: n.type === 'DELAY' ? n.delayTicks : undefined,
        osTargetTime: n.type === 'OSCLOCK' ? n.osTargetTime : undefined,
        osAlarmTriggered: n.type === 'OSCLOCK' ? n.osAlarmTriggered : undefined,
        osAlarmStopped: n.type === 'OSCLOCK' ? n.osAlarmStopped : undefined
      })),
      wires: wires.map(w=>({ from: w.from, to: w.to, toIndex: w.toIndex, fromIndex: w.fromIndex }))
    };
  }

  function saveBoard(){
    const blob = new Blob([JSON.stringify(serializeBoard(), null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'breadboard-circuit.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Board saved');
  }

  function saveAsChip(){
    const inputs = Array.from(nodes.values()).filter(node => node.type === 'INPUT').sort((a, b) => a.y - b.y || a.x - b.x);
    const outputs = Array.from(nodes.values()).filter(node => node.type === 'OUTPUT').sort((a, b) => a.y - b.y || a.x - b.x);
    if(inputs.length === 0 || outputs.length === 0) {
      toast('Add at least one switch and lamp first');
      return;
    }
    const name = window.prompt('Name this chip:', 'Custom Chip');
    if(!name || !name.trim()) return;
    const definition = serializeBoard();
    definition.name = name.trim();
    definition.inputs = inputs.map(node => node.id);
    definition.outputs = outputs.map(node => node.id);
    const result = registerChip(definition);
    snapshot();
    toast(result.persisted ? `Saved chip: ${definition.name}` : `Chip ready: ${definition.name} (session only)`);
  }

  function rebuildFromData(data, opts){
    const clear = !opts || opts.clear !== false;
    if(clear) clearBoard();
    if(data.customChips) {
      Object.values(data.customChips).forEach(definition => registerChip(definition));
    }
    const idMap = new Map();
    data.nodes.forEach(saved=>{
      if(INPUT_COUNT[saved.type] === undefined) return;
      const n = createNode(saved.type, saved.x||0, saved.y||0);
      n.rotation = saved.rotation || 0;
      n.el.style.transform = `scale(${nodeScale}) rotate(${n.rotation}deg)`;
      idMap.set(saved.id, n.id);
      if(saved.type === 'INPUT' && saved.value){
        n.value = true;
        const toggle = n.el.querySelector('.toggle');
        if(toggle) toggle.classList.add('on');
      }
      if(saved.type === 'CLOCK' && saved.period){
        n.period = saved.period;
        n.startTime = Date.now();
        const selectEl = n.el.querySelector('.clock-select');
        if(selectEl) selectEl.value = saved.period;
      }
      if(saved.type === 'DELAY' && saved.delayTicks){
        n.delayTicks = saved.delayTicks;
        n.buffer = new Array(n.delayTicks).fill(false);
        const selectEl = n.el.querySelector('.delay-select');
        if(selectEl) selectEl.value = saved.delayTicks;
      }
      if(saved.type === 'OSCLOCK' && saved.osTargetTime){
        n.osTargetTime = saved.osTargetTime;
        n.osAlarmTriggered = !!saved.osAlarmTriggered;
        n.osAlarmStopped = !!saved.osAlarmStopped;
        const alarmInput = n.el.querySelector('.osclock-input');
        if(alarmInput) {
          const date = new Date(saved.osTargetTime);
          const pad = value => String(value).padStart(2, '0');
          alarmInput.value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
        }
        n.value = n.osAlarmTriggered;
      }
    });
    data.wires.forEach(w=>{
      const fromId = idMap.get(w.from);
      const toId = idMap.get(w.to);
      if(fromId && toId) createWire(fromId, toId, w.toIndex, w.fromIndex || 0);
    });
    return idMap;
  }

  function loadBoardFromData(data){
    if(!data || !Array.isArray(data.nodes) || !Array.isArray(data.wires)){
      toast('Invalid board file');
      return;
    }
    rebuildFromData(data);
    snapshot();
    toast('Board loaded');
  }

  let history = [];
  let historyIndex = -1;
  const HISTORY_LIMIT = 60;

  function snapshot(){
    const state = JSON.stringify(serializeBoard());
    history = history.slice(0, historyIndex+1);
    history.push(state);
    if(history.length > HISTORY_LIMIT) history.shift();
    historyIndex = history.length - 1;
  }

  function restoreSnapshot(json){
    try { rebuildFromData(JSON.parse(json)); } catch(err) { /* corrupt entry */ }
  }

  function undo(){
    if(historyIndex <= 0){ toast('Nothing to undo'); return; }
    historyIndex--;
    restoreSnapshot(history[historyIndex]);
    toast('Undo');
  }

  function redo(){
    if(historyIndex >= history.length - 1){ toast('Nothing to redo'); return; }
    historyIndex++;
    restoreSnapshot(history[historyIndex]);
    toast('Redo');
  }

  let clipboard = null;
  let pasteOffset = 40;

  function copySelection(){
    if(selectedNodeIds.size === 0){ toast('Nothing selected to copy'); return; }
    const ids = Array.from(selectedNodeIds);
    clipboard = {
      nodes: ids.map(id=>{
        const n = nodes.get(id);
        return { id:n.id, type:n.type, x:n.x, y:n.y, rotation:n.rotation || 0,
          value: n.type === 'INPUT' ? !!n.value : undefined,
          period: n.type === 'CLOCK' ? n.period : undefined,
          delayTicks: n.type === 'DELAY' ? n.delayTicks : undefined,
          osTargetTime: n.type === 'OSCLOCK' ? n.osTargetTime : undefined,
          osAlarmTriggered: n.type === 'OSCLOCK' ? n.osAlarmTriggered : undefined,
          osAlarmStopped: n.type === 'OSCLOCK' ? n.osAlarmStopped : undefined };
      }),
      wires: wires.filter(w=>selectedNodeIds.has(w.from) && selectedNodeIds.has(w.to))
                  .map(w=>({ from:w.from, to:w.to, toIndex:w.toIndex, fromIndex:w.fromIndex }))
    };
    pasteOffset = 40;
    toast(`Copied ${ids.length} part${ids.length>1?'s':''}`);
  }

  function pasteClipboard(){
    if(!clipboard || clipboard.nodes.length === 0){ toast('Nothing to paste'); return; }
    const offsetData = {
      nodes: clipboard.nodes.map(n=>({ ...n, x: n.x+pasteOffset, y: n.y+pasteOffset })),
      wires: clipboard.wires
    };
    const idMap = rebuildFromData(offsetData, { clear:false });
    selectedNodeIds.clear();
    nodes.forEach(n=>n.el.classList.remove('selected'));
    idMap.forEach(newId=>{
      selectedNodeIds.add(newId);
      const n = nodes.get(newId);
      if(n) n.el.classList.add('selected');
    });
    pasteOffset += 40;
    snapshot();
    toast(`Pasted ${idMap.size} part${idMap.size>1?'s':''}`);
  }

  document.getElementById('saveBoard').addEventListener('click', saveBoard);
  document.getElementById('saveChip').addEventListener('click', saveAsChip);
  document.getElementById('saveChipPalette').addEventListener('click', saveAsChip);

  const loadBoardInput = document.getElementById('loadBoardInput');
  document.getElementById('loadBoardBtn').addEventListener('click', ()=> loadBoardInput.click());
  loadBoardInput.addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadBoardFromData(JSON.parse(reader.result));
      } catch(err) {
        toast('Could not parse file');
      }
    };
    reader.readAsText(file);
    loadBoardInput.value = '';
  });

  document.getElementById('loadHalfAdder').addEventListener('click', ()=>{
    clearBoard();
    const a  = createNode('INPUT', 60, 80);
    const b  = createNode('INPUT', 60, 220);
    const xo = createNode('XOR', 320, 70);
    const an = createNode('AND', 320, 230);
    const sum = createNode('OUTPUT', 580, 70);
    const carry = createNode('OUTPUT', 580, 230);
    createWire(a.id, xo.id, 0);
    createWire(b.id, xo.id, 1);
    createWire(a.id, an.id, 0);
    createWire(b.id, an.id, 1);
    createWire(xo.id, sum.id, 0);
    createWire(an.id, carry.id, 0);
    snapshot();
    toast('Half adder loaded');
  });

  document.getElementById('loadLatch').addEventListener('click', ()=>{
    clearBoard();
    const s  = createNode('INPUT', 50, 60);
    const r  = createNode('INPUT', 50, 260);
    const n1 = createNode('NOR', 320, 90);
    const n2 = createNode('NOR', 320, 230);
    const q  = createNode('OUTPUT', 580, 90);
    const qn = createNode('OUTPUT', 580, 230);
    createWire(s.id, n1.id, 0);
    createWire(r.id, n2.id, 1);
    createWire(n1.id, n2.id, 0);
    createWire(n2.id, n1.id, 1);
    createWire(n1.id, q.id, 0);
    createWire(n2.id, qn.id, 0);
    snapshot();
    toast('SR latch loaded');
  });

  snapshot();

})();