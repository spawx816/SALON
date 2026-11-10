/**
 * Quality Gate: Modal Accessibility & Focus Management (REM-P2-06 & Addendum 8)
 * (backend/tests/test_accessibility_modal.cjs)
 */

'use strict';

const assert = require('assert');

// Simple DOM Mock for unit testing accessible modal focus trap & escape handlers in Node.js
class MockElement {
  constructor(tag, attributes = {}) {
    this.tagName = tag.toUpperCase();
    this.attributes = { ...attributes };
    this.eventListeners = {};
    this.children = [];
    this.offsetParent = {}; // visible
    this.textContent = '';
  }

  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }

  addEventListener(type, handler) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(handler);
  }

  removeEventListener(type, handler) {
    if (!this.eventListeners[type]) return;
    this.eventListeners[type] = this.eventListeners[type].filter(h => h !== handler);
  }

  dispatchEvent(event) {
    const handlers = this.eventListeners[event.type] || [];
    for (const h of handlers) h(event);
  }

  focus() {
    global.document.activeElement = this;
  }

  querySelectorAll(selector) {
    const matched = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (child.tagName === 'BUTTON' || child.tagName === 'INPUT' || child.tagName === 'SELECT') {
          matched.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return matched;
  }
}

global.document = { activeElement: null };

async function runAccessibilityModalTests() {
  console.log('========================================================================');
  console.log('🛡️ SUITE: ACCESIBILIDAD, FOCUS TRAP Y BLOQUEO DE ESCAPE (REM-P2-06 & Addendum 8)');
  console.log('========================================================================\n');

  // Dynamic import of ES Module
  const { setupAccessibleModal } = await import('../../src/utils/accessibleModal.js');

  // --- TEST 1: Escape cierra modal ordinario inactivo ---
  console.log('--- TEST 1: Tecla Escape cierra modal cuando isProcessing=false ---');
  const triggerBtn = new MockElement('button');
  const modalEl = new MockElement('div');
  const inputEl = new MockElement('input');
  const closeBtn = new MockElement('button');
  modalEl.children.push(inputEl, closeBtn);

  let closeCalled = false;
  const teardown1 = setupAccessibleModal({
    modalElement: modalEl,
    triggerElement: triggerBtn,
    onClose: () => { closeCalled = true; },
    isProcessing: false
  });

  const escapeEvent = {
    type: 'keydown',
    key: 'Escape',
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {}
  };

  modalEl.dispatchEvent(escapeEvent);
  assert.strictEqual(closeCalled, true, 'onClose debió ser invocado');
  assert.strictEqual(escapeEvent.defaultPrevented, true);
  console.log('  ✅ [PASS 1] Tecla Escape cierra el modal ordinario correctamente');

  // --- TEST 2: Escape BLOQUEADO durante operación activa (Addendum 8) ---
  console.log('\n--- TEST 2: Bloqueo de Escape durante operación activa (pago/arqueo en curso) ---');
  let activeCloseCalled = false;
  const liveRegion = new MockElement('div');

  const teardown2 = setupAccessibleModal({
    modalElement: modalEl,
    triggerElement: triggerBtn,
    onClose: () => { activeCloseCalled = true; },
    isProcessing: true, // PROCESAMIENTO ACTIVO
    liveRegionElement: liveRegion
  });

  const activeEscapeEvent = {
    type: 'keydown',
    key: 'Escape',
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; }
  };

  modalEl.dispatchEvent(activeEscapeEvent);
  assert.strictEqual(activeCloseCalled, false, 'onClose NO debe ejecutarse durante isProcessing=true');
  assert.strictEqual(activeEscapeEvent.defaultPrevented, true);
  assert.strictEqual(activeEscapeEvent.propagationStopped, true);
  assert.strictEqual(liveRegion.attributes['aria-live'], 'assertive');
  assert.ok(liveRegion.textContent.includes('Operación en proceso'));
  console.log('  ✅ [PASS 2] Tecla Escape bloqueada categóricamente durante procesamiento con anuncio aria-live');

  // --- TEST 3: Focus Trap (Tab desde último elemento redirige al primero) ---
  console.log('\n--- TEST 3: Focus Trap cíclico entre primer y último elemento focusable ---');
  global.document.activeElement = closeBtn; // Currently at last element

  const tabEvent = {
    type: 'keydown',
    key: 'Tab',
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
  };

  modalEl.dispatchEvent(tabEvent);
  assert.strictEqual(tabEvent.defaultPrevented, true);
  assert.strictEqual(global.document.activeElement, inputEl, 'Foco debió volver al primer elemento focusable');
  console.log('  ✅ [PASS 3] Focus Trap cíclico hacia adelante verificado');

  // --- TEST 4: Focus Trap inverso (Shift+Tab desde primero redirige al último) ---
  console.log('\n--- TEST 4: Focus Trap inverso (Shift+Tab) ---');
  global.document.activeElement = inputEl;

  const shiftTabEvent = {
    type: 'keydown',
    key: 'Tab',
    shiftKey: true,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
  };

  modalEl.dispatchEvent(shiftTabEvent);
  assert.strictEqual(shiftTabEvent.defaultPrevented, true);
  assert.strictEqual(global.document.activeElement, closeBtn, 'Foco debió volver al último elemento focusable');
  console.log('  ✅ [PASS 4] Focus Trap inverso (Shift+Tab) verificado');

  // --- TEST 5: Devolución de foco al disparador en teardown ---
  console.log('\n--- TEST 5: Devolución del foco al disparador al destruir modal ---');
  teardown2();
  assert.strictEqual(global.document.activeElement, triggerBtn, 'El foco debió restaurarse al botón disparador');
  console.log('  ✅ [PASS 5] Foco restaurado fielmente al disparador original');

  console.log('\n========================================================================');
  console.log('🎉 TODAS LAS PRUEBAS DE ACCESIBILIDAD Y FOCO PASARON (PASS)');
  console.log('========================================================================\n');
}

if (require.main === module) {
  runAccessibilityModalTests().catch(err => {
    console.error('\n❌ [FAIL] Error en pruebas de accesibilidad:', err);
    process.exit(1);
  });
}

module.exports = { runAccessibilityModalTests };
