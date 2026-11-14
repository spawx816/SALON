import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Package, Layers, ArrowLeftRight, ShoppingCart, Truck, AlertTriangle,
  Plus, Search, Filter, RefreshCw, CheckCircle2, XCircle, DollarSign,
  TrendingUp, Lock, ShieldCheck, ArrowDownRight, ArrowUpRight, Warehouse
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useEntitlements } from '../../context/EntitlementsContext';

export default function InventoryModule() {
  const { canAccess, isPro } = useEntitlements();
  const hasInventory = canAccess('inventory');
  const hasAdvanced = canAccess('inventory_advanced');

  const [activeTab, setActiveTab] = useState('products'); // 'products', 'stock', 'movements', 'suppliers', 'orders', 'transfers', 'valuation'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Data states
  const [products, setProducts] = useState([]);
  const [stockList, setStockList] = useState([]);
  const [movements, setMovements] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [valuation, setValuation] = useState([]);
  const [alertSettings, setAlertSettings] = useState({ alerts_enabled: true, default_min_stock: 5 });
  const [alertOverrides, setAlertOverrides] = useState([]);
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [overrideForm, setOverrideForm] = useState({
    product_id: '',
    location_id: '',
    min_stock: '',
    alerts_enabled: 'inherit'
  });

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');

  // Modals & Forms
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [adjSearch, setAdjSearch] = useState('');
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [submittingAdj, setSubmittingAdj] = useState(false);
  const [adjForm, setAdjForm] = useState({
    productId: '',
    quantity: '1',
    adjustmentType: 'ADJUSTMENT_IN',
    reason: ''
  });

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [submittingTrf, setSubmittingTrf] = useState(false);
  const [transferForm, setTransferForm] = useState({
    transfer_number: '',
    source_location_id: '',
    destination_location_id: '',
    notes: '',
    productId: '',
    quantity: '1'
  });

  const showNotification = (msg, isErr = false) => {
    if (isErr) {
      setError(msg);
      setTimeout(() => setError(null), 6000);
    } else {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(null), 4000);
    }
  };

  const handleSaveGeneralAlerts = async (e) => {
    e.preventDefault();
    setSavingAlerts(true);
    try {
      await dataService.updateInventoryAlertSettings({
        alerts_enabled: Boolean(alertSettings.alerts_enabled),
        default_min_stock: Number(alertSettings.default_min_stock)
      });
      showNotification('Configuración general de alertas guardada.');
      await loadTabData();
    } catch (err) {
      showNotification(err.message || 'Error guardando configuración de alertas', true);
    } finally {
      setSavingAlerts(false);
    }
  };

  const handleSaveOverride = async (e) => {
    e.preventDefault();
    if (!overrideForm.product_id) {
      showNotification('Selecciona un producto para configurar la excepción.', true);
      return;
    }
    setSavingAlerts(true);
    try {
      await dataService.upsertInventoryAlertOverride({
        product_id: Number(overrideForm.product_id),
        location_id: overrideForm.location_id || null,
        min_stock: overrideForm.min_stock === '' ? null : Number(overrideForm.min_stock),
        alerts_enabled:
          overrideForm.alerts_enabled === 'inherit'
            ? null
            : overrideForm.alerts_enabled === 'enabled'
      });
      setOverrideForm({ product_id: '', location_id: '', min_stock: '', alerts_enabled: 'inherit' });
      showNotification('Excepción de alerta guardada.');
      await loadTabData();
    } catch (err) {
      showNotification(err.message || 'Error guardando excepción de alerta', true);
    } finally {
      setSavingAlerts(false);
    }
  };

  const handleDeleteOverride = async (overrideId) => {
    setSavingAlerts(true);
    try {
      await dataService.deleteInventoryAlertOverride(overrideId);
      showNotification('Excepción eliminada. El producto hereda el valor general.');
      await loadTabData();
    } catch (err) {
      showNotification(err.message || 'Error eliminando excepción', true);
    } finally {
      setSavingAlerts(false);
    }
  };

  useEffect(() => {
    if (!hasInventory) return;
    loadTabData();
  }, [activeTab, hasInventory]);

  const loadTabData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === 'products') {
        const data = await dataService.getInventoryProducts({ search: searchTerm });
        setProducts(data || []);
      } else if (activeTab === 'stock') {
        const [stk, alr, cfg, prods, locs] = await Promise.all([
          dataService.getInventoryStock(),
          dataService.getInventoryAlerts(),
          dataService.getInventoryAlertSettings().catch(() => ({ settings: { alerts_enabled: true, default_min_stock: 5 }, overrides: [] })),
          products.length > 0 ? Promise.resolve(products) : dataService.getInventoryProducts({ activeOnly: true }).catch(() => []),
          locations.length > 0 ? Promise.resolve(locations) : dataService.getInventoryLocations().catch(() => [])
        ]);
        setStockList(stk || []);
        setAlerts(alr || []);
        if (cfg?.settings) {
          setAlertSettings({
            alerts_enabled: Boolean(cfg.settings.alerts_enabled),
            default_min_stock: cfg.settings.default_min_stock ?? 5
          });
        }
        setAlertOverrides(cfg?.overrides || []);
        if (products.length === 0) setProducts(prods || []);
        if (locations.length === 0) setLocations(locs || []);
      } else if (activeTab === 'movements') {
        const data = await dataService.getInventoryMovements();
        setMovements(data || []);
      } else if (activeTab === 'suppliers' && hasAdvanced) {
        const data = await dataService.getInventorySuppliers();
        setSuppliers(data || []);
      } else if (activeTab === 'orders' && hasAdvanced) {
        const data = await dataService.getInventoryPurchaseOrders();
        setPurchaseOrders(data || []);
      } else if (activeTab === 'transfers' && hasAdvanced) {
        const [trf, locs, prods] = await Promise.all([
          dataService.getInventoryTransfers(),
          dataService.getInventoryLocations(),
          dataService.getInventoryProducts({ activeOnly: true })
        ]);
        setTransfers(trf || []);
        setLocations(locs || []);
        setProducts(prods || []);
      } else if (activeTab === 'valuation' && hasAdvanced) {
        const data = await dataService.getInventoryValuation();
        setValuation(data || []);
      }
    } catch (err) {
      showNotification(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const openAdjustmentModal = async (preselectedProductId = '') => {
    setAdjSearch('');
    setAdjForm({
      productId: preselectedProductId ? String(preselectedProductId) : '',
      quantity: '1',
      adjustmentType: 'ADJUSTMENT_IN',
      reason: ''
    });
    setShowAdjustmentModal(true);
    try {
      const activeProds = await dataService.getInventoryProducts({ activeOnly: true });
      const onlyProducts = (activeProds || []).filter(
        p => (!p.item_type || String(p.item_type).toUpperCase() === 'PRODUCTO') && p.is_active !== false && p.activo !== 0
      );
      setCatalogProducts(onlyProducts);
    } catch (err) {
      showNotification(err.message, true);
    }
  };

  const handleAdjustment = async (e) => {
    e.preventDefault();
    if (submittingAdj) return;
    setSubmittingAdj(true);
    try {
      await dataService.makeInventoryAdjustment(adjForm);
      showNotification('Ajuste de inventario aplicado correctamente');
      setShowAdjustmentModal(false);
      setAdjForm({ productId: '', quantity: '1', adjustmentType: 'ADJUSTMENT_IN', reason: '' });
      loadTabData();
    } catch (err) {
      showNotification(err.message, true);
    } finally {
      setSubmittingAdj(false);
    }
  };

  const handleCreateTransfer = async (e) => {
    e.preventDefault();
    if (submittingTrf) return;
    setSubmittingTrf(true);
    try {
      await dataService.createInventoryTransfer({
        transfer_number: transferForm.transfer_number || `TRF-${Date.now().toString().slice(-6)}`,
        source_location_id: transferForm.source_location_id,
        destination_location_id: transferForm.destination_location_id,
        notes: transferForm.notes,
        items: [
          { product_id: transferForm.productId, quantity_requested: Number(transferForm.quantity) }
        ]
      });
      showNotification('Transferencia solicitada exitosamente');
      setShowTransferModal(false);
      setTransferForm({
        transfer_number: '',
        source_location_id: '',
        destination_location_id: '',
        notes: '',
        productId: '',
        quantity: '1'
      });
      loadTabData();
    } catch (err) {
      showNotification(err.message, true);
    } finally {
      setSubmittingTrf(false);
    }
  };

  if (!hasInventory) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', background: '#fff', borderRadius: '12px', margin: '2rem' }}>
        <Lock size={48} color="#ef4444" style={{ margin: '0 auto 1rem' }} />
        <h2>Módulo de Inventario no disponible</h2>
        <p style={{ color: '#64748b' }}>Tu suscripción actual no incluye acceso al sistema de inventario.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Package color="#2563eb" /> Inventario Multi-Tenant Real
          </h1>
          <p style={{ margin: '0.2rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
            Catálogo de productos, existencias, libro mayor inmutable y transferencias multisucursal.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => openAdjustmentModal()}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              background: '#2563eb', color: '#fff', border: 'none',
              padding: '0.6rem 1.1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600
            }}
          >
            Ajustar Stock
          </button>
          {hasAdvanced && (
            <button
              onClick={() => setShowTransferModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                background: '#7c3aed', color: '#fff', border: 'none',
                padding: '0.6rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600
              }}
            >
              <ArrowLeftRight size={18} /> Transferir
            </button>
          )}
        </div>
      </div>

      {/* NOTIFICATIONS */}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '0.8rem 1rem', borderRadius: '8px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <XCircle size={18} /> {error}
        </div>
      )}
      {successMsg && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', padding: '0.8rem 1rem', borderRadius: '8px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle2 size={18} /> {successMsg}
        </div>
      )}

      {/* TABS NAVIGATION */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '0.3rem' }}>
        <button
          onClick={() => setActiveTab('products')}
          style={{
            background: 'none', border: 'none', padding: '0.6rem 1rem',
            borderBottom: activeTab === 'products' ? '3px solid #2563eb' : '3px solid transparent',
            color: activeTab === 'products' ? '#2563eb' : '#64748b', fontWeight: 600, cursor: 'pointer'
          }}
        >
          Productos (Base)
        </button>
        <button
          onClick={() => setActiveTab('stock')}
          style={{
            background: 'none', border: 'none', padding: '0.6rem 1rem',
            borderBottom: activeTab === 'stock' ? '3px solid #2563eb' : '3px solid transparent',
            color: activeTab === 'stock' ? '#2563eb' : '#64748b', fontWeight: 600, cursor: 'pointer'
          }}
        >
          Existencias & Alertas (Base)
        </button>
        <button
          onClick={() => setActiveTab('movements')}
          style={{
            background: 'none', border: 'none', padding: '0.6rem 1rem',
            borderBottom: activeTab === 'movements' ? '3px solid #2563eb' : '3px solid transparent',
            color: activeTab === 'movements' ? '#2563eb' : '#64748b', fontWeight: 600, cursor: 'pointer'
          }}
        >
          Ledger de Movimientos (Base)
        </button>
        <button
          onClick={() => hasAdvanced ? setActiveTab('transfers') : showNotification('Transferencias multisucursal requiere habilitar inventario avanzado', true)}
          style={{
            background: 'none', border: 'none', padding: '0.6rem 1rem',
            borderBottom: activeTab === 'transfers' ? '3px solid #7c3aed' : '3px solid transparent',
            color: activeTab === 'transfers' ? '#7c3aed' : '#64748b', fontWeight: 600, cursor: 'pointer',
            opacity: hasAdvanced ? 1 : 0.6
          }}
        >
          Transferencias {!hasAdvanced && '🔒'}
        </button>
        <button
          onClick={() => hasAdvanced ? setActiveTab('suppliers') : showNotification('Gestión de proveedores requiere habilitar inventario avanzado', true)}
          style={{
            background: 'none', border: 'none', padding: '0.6rem 1rem',
            borderBottom: activeTab === 'suppliers' ? '3px solid #7c3aed' : '3px solid transparent',
            color: activeTab === 'suppliers' ? '#7c3aed' : '#64748b', fontWeight: 600, cursor: 'pointer',
            opacity: hasAdvanced ? 1 : 0.6
          }}
        >
          Proveedores {!hasAdvanced && '🔒'}
        </button>
        <button
          onClick={() => hasAdvanced ? setActiveTab('orders') : showNotification('Órdenes de compra requiere habilitar inventario avanzado', true)}
          style={{
            background: 'none', border: 'none', padding: '0.6rem 1rem',
            borderBottom: activeTab === 'orders' ? '3px solid #7c3aed' : '3px solid transparent',
            color: activeTab === 'orders' ? '#7c3aed' : '#64748b', fontWeight: 600, cursor: 'pointer',
            opacity: hasAdvanced ? 1 : 0.6
          }}
        >
          Órdenes de Compra {!hasAdvanced && '🔒'}
        </button>
        <button
          onClick={() => hasAdvanced ? setActiveTab('valuation') : showNotification('Valorización avanzada requiere habilitar inventario avanzado', true)}
          style={{
            background: 'none', border: 'none', padding: '0.6rem 1rem',
            borderBottom: activeTab === 'valuation' ? '3px solid #7c3aed' : '3px solid transparent',
            color: activeTab === 'valuation' ? '#7c3aed' : '#64748b', fontWeight: 600, cursor: 'pointer',
            opacity: hasAdvanced ? 1 : 0.6
          }}
        >
          Valorización {!hasAdvanced && '🔒'}
        </button>
      </div>

      {/* CONTENT BY TAB */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
          <RefreshCw className="animate-spin" size={32} style={{ margin: '0 auto 0.5rem' }} />
          <p>Cargando datos de inventario...</p>
        </div>
      ) : (
        <>
          {/* TAB 1: PRODUCTOS */}
          {activeTab === 'products' && (
            <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
              <div style={{ padding: '1rem', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', padding: '0.5rem 0.8rem', borderRadius: '6px', width: '320px', border: '1px solid #e2e8f0' }}>
                  <Search size={16} color="#64748b" />
                  <input
                    type="text"
                    placeholder="Buscar por SKU, Nombre o Código..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && loadTabData()}
                    style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.9rem' }}
                  />
                </div>
                <button onClick={loadTabData} style={{ background: '#f1f5f9', border: 'none', padding: '0.5rem 0.8rem', borderRadius: '6px', cursor: 'pointer' }}>
                  Buscar
                </button>
              </div>

              {products.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                  <Package size={40} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
                  <p>No se encontraron productos en el catálogo de este salón.</p>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '0.75rem 1rem' }}>SKU</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Producto</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Categoría</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Precio Venta</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Costo</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Stock Mínimo</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Control Stock</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(p => (
                      <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#334155' }}>{p.sku || '—'}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>{p.name}</div>
                          {p.barcode && <span style={{ fontSize: '0.75rem', color: '#64748b' }}>EAN: {p.barcode}</span>}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{p.category}</td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#16a34a' }}>RD$ {Number(p.sale_price).toFixed(2)}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>RD$ {Number(p.cost).toFixed(2)}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{Number(p.min_stock).toFixed(0)} {p.unit_of_measure}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{
                            padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600,
                            background: p.track_stock ? '#dbeafe' : '#f1f5f9', color: p.track_stock ? '#1e40af' : '#64748b'
                          }}>
                            {p.track_stock ? 'Controlado' : 'Sin Stock'}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => openAdjustmentModal(p.id)}
                            style={{
                              background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
                              padding: '0.3rem 0.7rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600
                            }}
                          >
                            Ajustar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 2: EXISTENCIAS & ALERTAS */}
          {activeTab === 'stock' && (
            <div>
              {/* PANEL DE CONFIGURACIÓN EDITABLE DE ALERTAS */}
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
                      Configuración de Alertas de Inventario
                    </h3>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#475569' }}>
                      Alertar cuando las existencias sean iguales o inferiores a <strong>{Number(alertSettings.default_min_stock ?? 0)}</strong>
                    </p>
                  </div>
                  <form onSubmit={handleSaveGeneralAlerts} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 600, color: '#1e293b', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(alertSettings.alerts_enabled)}
                        onChange={(e) => setAlertSettings({ ...alertSettings, alerts_enabled: e.target.checked })}
                      />
                      Alertas activas
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>
                      Umbral general:
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={alertSettings.default_min_stock}
                        onChange={(e) => setAlertSettings({ ...alertSettings, default_min_stock: e.target.value })}
                        style={{ width: '80px', padding: '0.35rem 0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.85rem' }}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={savingAlerts}
                      style={{ background: '#0f172a', color: '#fff', border: 'none', padding: '0.42rem 0.85rem', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      {savingAlerts ? 'Guardando...' : 'Guardar general'}
                    </button>
                  </form>
                </div>

                {/* EXCEPCIONES POR PRODUCTO O SUCURSAL */}
                <form onSubmit={handleSaveOverride} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>Excepción:</span>
                  <select
                    value={overrideForm.product_id}
                    onChange={(e) => setOverrideForm({ ...overrideForm, product_id: e.target.value })}
                    style={{ padding: '0.35rem 0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.82rem', minWidth: '180px' }}
                  >
                    <option value="">Seleccionar producto...</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name || p.nombre} {p.sku ? `(${p.sku})` : ''}</option>
                    ))}
                  </select>
                  <select
                    value={overrideForm.location_id}
                    onChange={(e) => setOverrideForm({ ...overrideForm, location_id: e.target.value })}
                    style={{ padding: '0.35rem 0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.82rem' }}
                  >
                    <option value="">Todas las ubicaciones</option>
                    {locations.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Umbral (ej: 0)"
                    value={overrideForm.min_stock}
                    onChange={(e) => setOverrideForm({ ...overrideForm, min_stock: e.target.value })}
                    style={{ width: '115px', padding: '0.35rem 0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.82rem' }}
                  />
                  <select
                    value={overrideForm.alerts_enabled}
                    onChange={(e) => setOverrideForm({ ...overrideForm, alerts_enabled: e.target.value })}
                    style={{ padding: '0.35rem 0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.82rem' }}
                  >
                    <option value="inherit">Estado: Heredar general</option>
                    <option value="enabled">Estado: Activa</option>
                    <option value="disabled">Estado: Desactivada</option>
                  </select>
                  <button
                    type="submit"
                    disabled={savingAlerts}
                    style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '0.38rem 0.75rem', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Guardar excepción
                  </button>
                </form>

                {alertOverrides.length > 0 && (
                  <div style={{ marginTop: '0.65rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {alertOverrides.map(ov => (
                      <span
                        key={ov.id}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.78rem', color: '#334155' }}
                      >
                        <strong>{ov.product_name}</strong>
                        <span>({ov.location_name || 'Todas'})</span>
                        <span>
                          {ov.min_stock !== null ? `≤ ${ov.min_stock}` : 'Umbral heredado'}
                          {ov.alerts_enabled === false ? ' · Desactivada' : ov.alerts_enabled === true ? ' · Activa' : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteOverride(ov.id)}
                          title="Eliminar excepción y heredar valor general"
                          style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', fontWeight: 700, padding: 0 }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {alerts.length > 0 && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', color: '#b45309', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <AlertTriangle size={18} /> Alertas de Reabastecimiento ({alerts.length} producto(s) bajo mínimo)
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.8rem' }}>
                    {alerts.map(a => (
                      <div key={a.product_id} style={{ background: '#fff', padding: '0.8rem', borderRadius: '6px', border: '1px solid #fcd34d' }}>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{a.product_name} ({a.sku})</div>
                        <div style={{ fontSize: '0.85rem', color: '#b45309', marginTop: '0.2rem' }}>
                          Existencia: <strong>{Number(a.current_stock).toFixed(0)}</strong> / Mínimo: {Number(a.min_stock).toFixed(0)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '0.75rem 1rem' }}>SKU</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Producto</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Almacén / Ubicación</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Cantidad Disponible</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Umbral Mínimo</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Costo Promedio</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Estado</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockList.map(s => {
                      const isLow = Boolean(s.alerts_enabled ?? true) && Number(s.quantity) <= Number(s.min_stock ?? 0);
                      const sourceLabel = s.threshold_source === 'location'
                        ? 'Por sucursal'
                        : s.threshold_source === 'product'
                          ? 'Por producto'
                          : 'Heredado del valor general';
                      return (
                        <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{s.sku || '—'}</td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0f172a' }}>{s.product_name}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{s.location_name}</td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 700, fontSize: '1rem', color: isLow ? '#dc2626' : '#0f172a' }}>
                            {Number(s.quantity).toFixed(2)} {s.unit_of_measure}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontSize: '0.82rem', color: '#475569' }}>
                            <div><strong>≤ {Number(s.min_stock ?? 0)}</strong></div>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{sourceLabel}</div>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>RD$ {Number(s.average_cost).toFixed(2)}</td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <span style={{
                              padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600,
                              background: isLow ? '#fee2e2' : '#dcfce7', color: isLow ? '#991b1b' : '#166534'
                            }}>
                              {isLow ? 'Stock Bajo' : 'Normal'}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                            <button
                              type="button"
                              onClick={() => openAdjustmentModal(s.product_id)}
                              style={{
                                background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
                                padding: '0.3rem 0.7rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600
                              }}
                            >
                              Ajustar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: LIBRO MAYOR DE MOVIMIENTOS */}
          {activeTab === 'movements' && (
            <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Fecha</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Tipo</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Producto</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Cantidad</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Saldo Posterior</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Motivo / Referencia</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Usuario</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map(m => {
                    const isPositive = Number(m.quantity) > 0;
                    return (
                      <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.75rem 1rem', color: '#64748b', fontSize: '0.8rem' }}>
                          {new Date(m.created_at).toLocaleString('es-DO')}
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{
                            padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700,
                            background: isPositive ? '#dcfce7' : '#fee2e2', color: isPositive ? '#166534' : '#991b1b'
                          }}>
                            {m.movement_type}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{m.product_name || m.product_id}</td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: isPositive ? '#16a34a' : '#dc2626' }}>
                          {isPositive ? `+${Number(m.quantity).toFixed(2)}` : Number(m.quantity).toFixed(2)}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#334155' }}>
                          {Number(m.balance_after).toFixed(2)}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', color: '#64748b', fontSize: '0.85rem' }}>
                          {m.reason || m.reference_id || 'N/A'}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{m.user_name || 'Sistema'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 4: TRANSFERENCIAS (PRO) */}
          {activeTab === 'transfers' && hasAdvanced && (
            <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Transferencia #</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Origen</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Destino</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Estado</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{t.transfer_number}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>{t.source_location_name}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>{t.destination_location_name}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{
                          padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700,
                          background: t.status === 'RECEIVED' ? '#dcfce7' : (t.status === 'DISPATCHED' ? '#dbeafe' : '#fef3c7'),
                          color: t.status === 'RECEIVED' ? '#166534' : (t.status === 'DISPATCHED' ? '#1e40af' : '#92400e')
                        }}>
                          {t.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {t.status === 'REQUESTED' && (
                          <button
                            onClick={async () => {
                              try {
                                await dataService.dispatchInventoryTransfer(t.id);
                                showNotification('Transferencia despachada');
                                loadTabData();
                              } catch (e) { showNotification(e.message, true); }
                            }}
                            style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                          >
                            Despachar
                          </button>
                        )}
                        {t.status === 'DISPATCHED' && (
                          <button
                            onClick={async () => {
                              try {
                                await dataService.receiveInventoryTransfer(t.id);
                                showNotification('Transferencia recibida en destino');
                                loadTabData();
                              } catch (e) { showNotification(e.message, true); }
                            }}
                            style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                          >
                            Recibir
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 5: VALORIZACIÓN (PRO) */}
          {activeTab === 'valuation' && hasAdvanced && (
            <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>SKU</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Producto</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Almacén</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Cantidad</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Costo Promedio</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Valorización Total (Costo)</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Valor Potencial (Venta)</th>
                  </tr>
                </thead>
                <tbody>
                  {valuation.map((v, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{v.sku}</td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0f172a' }}>{v.product_name}</td>
                      <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{v.location_name}</td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{Number(v.quantity).toFixed(2)}</td>
                      <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>RD$ {Number(v.average_cost).toFixed(2)}</td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#2563eb' }}>RD$ {Number(v.total_valuation).toFixed(2)}</td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#16a34a' }}>RD$ {Number(v.total_potential_revenue).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* MODAL AJUSTE MANUAL */}
      {showAdjustmentModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '480px', maxWidth: '94vw', padding: '1.5rem' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', color: '#0f172a' }}>Ajuste Manual de Existencias</h2>
            {catalogProducts.length === 0 ? (
              <div style={{ padding: '1rem 0' }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem', color: '#334155', marginBottom: '1rem' }}>
                  <p style={{ margin: '0 0 0.75rem', fontWeight: 600 }}>Crea primero un producto en el Catálogo</p>
                  <Link
                    to="/servicios"
                    onClick={() => setShowAdjustmentModal(false)}
                    style={{
                      display: 'inline-block', background: '#2563eb', color: '#fff',
                      padding: '0.5rem 1rem', borderRadius: '6px', textDecoration: 'none', fontWeight: 600, fontSize: '0.88rem'
                    }}
                  >
                    Ir al Catálogo
                  </Link>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setShowAdjustmentModal(false)}
                    style={{ background: '#f1f5f9', border: 'none', padding: '0.6rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            ) : (
            <form onSubmit={handleAdjustment}>
              <div style={{ marginBottom: '0.8rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Buscar por nombre, SKU o código de barras</label>
                <input
                  type="text"
                  placeholder="Filtrar productos del Catálogo..."
                  value={adjSearch}
                  onChange={(e) => setAdjSearch(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px', marginBottom: '0.5rem' }}
                />
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Producto *</label>
                <select
                  required
                  value={adjForm.productId}
                  onChange={(e) => setAdjForm({ ...adjForm, productId: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                >
                  <option value="">Selecciona un producto...</option>
                  {catalogProducts
                    .filter(p => {
                      const q = adjSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        (p.name && p.name.toLowerCase().includes(q)) ||
                        (p.sku && p.sku.toLowerCase().includes(q)) ||
                        (p.barcode && p.barcode.toLowerCase().includes(q))
                      );
                    })
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.sku ? ` (${p.sku})` : ''}{p.barcode ? ` [${p.barcode}]` : ''}
                      </option>
                    ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Tipo de Ajuste</label>
                  <select
                    value={adjForm.adjustmentType}
                    onChange={(e) => setAdjForm({ ...adjForm, adjustmentType: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                  >
                    <option value="ADJUSTMENT_IN">Entrada (+)</option>
                    <option value="ADJUSTMENT_OUT">Salida (-)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Cantidad *</label>
                  <input
                    required
                    type="number"
                    min="1"
                    value={adjForm.quantity}
                    onChange={(e) => setAdjForm({ ...adjForm, quantity: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '0.8rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Motivo del Ajuste *</label>
                <input
                  required
                  type="text"
                  placeholder="Ej: Conteo físico mensual, merma o rotura"
                  value={adjForm.reason}
                  onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.2rem' }}>
                <button
                  type="button"
                  onClick={() => setShowAdjustmentModal(false)}
                  style={{ background: '#f1f5f9', border: 'none', padding: '0.6rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingAdj}
                  style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                >
                  {submittingAdj ? 'Aplicando...' : 'Confirmar Ajuste'}
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL TRANSFERENCIA MULTISUCURSAL (PRO) */}
      {showTransferModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '500px', padding: '1.5rem' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', color: '#7c3aed' }}>Solicitud de Transferencia (Plan PRO)</h2>
            <form onSubmit={handleCreateTransfer}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Almacén Origen *</label>
                  <select
                    required
                    value={transferForm.source_location_id}
                    onChange={(e) => setTransferForm({ ...transferForm, source_location_id: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                  >
                    <option value="">Selecciona origen...</option>
                    {locations.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Almacén Destino *</label>
                  <select
                    required
                    value={transferForm.destination_location_id}
                    onChange={(e) => setTransferForm({ ...transferForm, destination_location_id: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                  >
                    <option value="">Selecciona destino...</option>
                    {locations.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '0.8rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Producto *</label>
                <select
                  required
                  value={transferForm.productId}
                  onChange={(e) => setTransferForm({ ...transferForm, productId: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                >
                  <option value="">Selecciona producto...</option>
                  {products.filter(p => p.track_stock).map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '0.8rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Cantidad a Transferir *</label>
                <input
                  required
                  type="number"
                  min="1"
                  value={transferForm.quantity}
                  onChange={(e) => setTransferForm({ ...transferForm, quantity: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.2rem' }}>
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  style={{ background: '#f1f5f9', border: 'none', padding: '0.6rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingTrf}
                  style={{ background: '#7c3aed', color: '#fff', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                >
                  {submittingTrf ? 'Enviando...' : 'Solicitar Transferencia'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

