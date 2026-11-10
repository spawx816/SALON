import React, { useState, useEffect } from 'react';
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

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');

  // Modals & Forms
  const [showProductModal, setShowProductModal] = useState(false);
  const [submittingProduct, setSubmittingProduct] = useState(false);
  const [productForm, setProductForm] = useState({
    sku: '',
    barcode: '',
    name: '',
    category: 'General',
    unit_of_measure: 'unit',
    sale_price: '',
    cost: '',
    tax_rate: '0.18',
    min_stock: '5',
    track_stock: true,
    initial_stock: '0'
  });

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
        const [stk, alr] = await Promise.all([
          dataService.getInventoryStock(),
          dataService.getInventoryAlerts()
        ]);
        setStockList(stk || []);
        setAlerts(alr || []);
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

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (submittingProduct) return;
    setSubmittingProduct(true);
    try {
      await dataService.createInventoryProduct(productForm);
      showNotification('Producto creado exitosamente en el catálogo');
      setShowProductModal(false);
      setProductForm({
        sku: '',
        barcode: '',
        name: '',
        category: 'General',
        unit_of_measure: 'unit',
        sale_price: '',
        cost: '',
        tax_rate: '0.18',
        min_stock: '5',
        track_stock: true,
        initial_stock: '0'
      });
      loadTabData();
    } catch (err) {
      showNotification(err.message, true);
    } finally {
      setSubmittingProduct(false);
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
            onClick={() => setShowProductModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              background: '#2563eb', color: '#fff', border: 'none',
              padding: '0.6rem 1.1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600
            }}
          >
            <Plus size={18} /> Nuevo Producto
          </button>
          <button
            onClick={() => setShowAdjustmentModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1',
              padding: '0.6rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600
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
          onClick={() => hasAdvanced ? setActiveTab('transfers') : showNotification('Transferencias multisucursal es exclusivo del Plan PRO', true)}
          style={{
            background: 'none', border: 'none', padding: '0.6rem 1rem',
            borderBottom: activeTab === 'transfers' ? '3px solid #7c3aed' : '3px solid transparent',
            color: activeTab === 'transfers' ? '#7c3aed' : '#64748b', fontWeight: 600, cursor: 'pointer',
            opacity: hasAdvanced ? 1 : 0.6
          }}
        >
          Transferencias {!hasAdvanced && '🔒 (PRO)'}
        </button>
        <button
          onClick={() => hasAdvanced ? setActiveTab('suppliers') : showNotification('Gestión de proveedores es exclusivo del Plan PRO', true)}
          style={{
            background: 'none', border: 'none', padding: '0.6rem 1rem',
            borderBottom: activeTab === 'suppliers' ? '3px solid #7c3aed' : '3px solid transparent',
            color: activeTab === 'suppliers' ? '#7c3aed' : '#64748b', fontWeight: 600, cursor: 'pointer',
            opacity: hasAdvanced ? 1 : 0.6
          }}
        >
          Proveedores {!hasAdvanced && '🔒 (PRO)'}
        </button>
        <button
          onClick={() => hasAdvanced ? setActiveTab('orders') : showNotification('Órdenes de compra es exclusivo del Plan PRO', true)}
          style={{
            background: 'none', border: 'none', padding: '0.6rem 1rem',
            borderBottom: activeTab === 'orders' ? '3px solid #7c3aed' : '3px solid transparent',
            color: activeTab === 'orders' ? '#7c3aed' : '#64748b', fontWeight: 600, cursor: 'pointer',
            opacity: hasAdvanced ? 1 : 0.6
          }}
        >
          Órdenes de Compra {!hasAdvanced && '🔒 (PRO)'}
        </button>
        <button
          onClick={() => hasAdvanced ? setActiveTab('valuation') : showNotification('Valorización avanzada es exclusivo del Plan PRO', true)}
          style={{
            background: 'none', border: 'none', padding: '0.6rem 1rem',
            borderBottom: activeTab === 'valuation' ? '3px solid #7c3aed' : '3px solid transparent',
            color: activeTab === 'valuation' ? '#7c3aed' : '#64748b', fontWeight: 600, cursor: 'pointer',
            opacity: hasAdvanced ? 1 : 0.6
          }}
        >
          Valorización {!hasAdvanced && '🔒 (PRO)'}
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
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(p => (
                      <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#334155' }}>{p.sku}</td>
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
                      <th style={{ padding: '0.75rem 1rem' }}>Costo Promedio</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockList.map(s => {
                      const isLow = s.quantity <= s.min_stock;
                      return (
                        <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{s.sku}</td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0f172a' }}>{s.product_name}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{s.location_name}</td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 700, fontSize: '1rem', color: isLow ? '#dc2626' : '#0f172a' }}>
                            {Number(s.quantity).toFixed(2)} {s.unit_of_measure}
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

      {/* MODAL CREAR PRODUCTO */}
      {showProductModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '550px', padding: '1.5rem', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', color: '#0f172a' }}>Nuevo Producto de Inventario</h2>
            <form onSubmit={handleCreateProduct}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>SKU *</label>
                  <input
                    required
                    type="text"
                    value={productForm.sku}
                    onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                    placeholder="Ej: SHAMP-001"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Código de Barras</label>
                  <input
                    type="text"
                    value={productForm.barcode}
                    onChange={(e) => setProductForm({ ...productForm, barcode: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                    placeholder="Ej: 7461234567890"
                  />
                </div>
              </div>

              <div style={{ marginBottom: '0.8rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Nombre del Producto *</label>
                <input
                  required
                  type="text"
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                  placeholder="Ej: Shampoo Keratina 500ml"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Precio de Venta (RD$) *</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={productForm.sale_price}
                    onChange={(e) => setProductForm({ ...productForm, sale_price: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Costo Unitario (RD$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={productForm.cost}
                    onChange={(e) => setProductForm({ ...productForm, cost: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Stock Mínimo (Alerta)</label>
                  <input
                    type="number"
                    min="0"
                    value={productForm.min_stock}
                    onChange={(e) => setProductForm({ ...productForm, min_stock: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Stock Inicial</label>
                  <input
                    type="number"
                    min="0"
                    value={productForm.initial_stock}
                    onChange={(e) => setProductForm({ ...productForm, initial_stock: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '1rem 0' }}>
                <input
                  type="checkbox"
                  id="chkTrackStock"
                  checked={productForm.track_stock}
                  onChange={(e) => setProductForm({ ...productForm, track_stock: e.target.checked })}
                />
                <label htmlFor="chkTrackStock" style={{ fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                  Activar control de existencias para este producto físico
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.2rem' }}>
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  style={{ background: '#f1f5f9', border: 'none', padding: '0.6rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingProduct}
                  style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                >
                  {submittingProduct ? 'Guardando...' : 'Crear Producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL AJUSTE MANUAL */}
      {showAdjustmentModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '480px', padding: '1.5rem' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', color: '#0f172a' }}>Ajuste Manual de Existencias</h2>
            <form onSubmit={handleAdjustment}>
              <div style={{ marginBottom: '0.8rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.2rem' }}>Producto *</label>
                <select
                  required
                  value={adjForm.productId}
                  onChange={(e) => setAdjForm({ ...adjForm, productId: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                >
                  <option value="">Selecciona un producto...</option>
                  {products.filter(p => p.track_stock).map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
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

