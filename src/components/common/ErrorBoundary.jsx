import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('CRITICAL UNCAUGHT UI ERROR:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          background: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#0f172a'
        }}>
          <div style={{
            maxWidth: '560px',
            width: '100%',
            background: '#ffffff',
            borderRadius: '20px',
            padding: '2.5rem',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            border: '1px solid #e2e8f0',
            textAlign: 'center'
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              background: '#fef2f2',
              color: '#dc2626',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
              marginBottom: '1.25rem'
            }}>
              ⚠️
            </div>

            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 0.5rem 0', color: '#0f172a' }}>
              Ha ocurrido un detalle al cargar esta vista
            </h2>
            
            <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: 1.5, margin: '0 0 1.5rem 0' }}>
              El sistema ha evitado que la pantalla quede en blanco. Puedes recargar la página o volver al panel principal.
            </p>

            {this.state.error && (
              <div style={{
                background: '#f1f5f9',
                padding: '0.85rem',
                borderRadius: '10px',
                textAlign: 'left',
                fontSize: '0.8rem',
                color: '#b91c1c',
                fontFamily: 'monospace',
                marginBottom: '1.5rem',
                overflowX: 'auto',
                maxHeight: '120px'
              }}>
                {this.state.error.toString()}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  background: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '12px',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer'
                }}
              >
                🔄 Recargar Página
              </button>

              <button
                type="button"
                onClick={() => { window.location.href = '/'; }}
                style={{
                  background: '#f1f5f9',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '12px',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer'
                }}
              >
                🏠 Ir al Inicio
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
