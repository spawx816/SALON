import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { User, MapPin, Phone, Mail, Menu, X } from 'lucide-react';

export const PublicHeader = ({ onOpenAuth }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const isHome = location.pathname === '/';

  const handleAuthAction = (isLoginMode, triggerEvent) => {
    setMobileMenuOpen(false);
    if (onOpenAuth) {
      onOpenAuth(isLoginMode, triggerEvent?.currentTarget);
    }
  };

  return (
    <header className="landing-header">
      <div className="container">
        <nav className="landing-nav" aria-label="Navegación principal">
          <div className="logo">
            <Link to="/" onClick={() => setMobileMenuOpen(false)}>
              PLAN<span>BEAUTY</span>SAAS
            </Link>
            <p>SOFTWARE PARA SALONES</p>
          </div>

          <ul className="nav-links">
            <li>
              {isHome ? (
                <a href="#inicio">Inicio</a>
              ) : (
                <Link to="/">Inicio</Link>
              )}
            </li>
            <li>
              {isHome ? (
                <a href="#modulos">Módulos</a>
              ) : (
                <Link to="/#modulos">Módulos</Link>
              )}
            </li>
            <li>
              {isHome ? (
                <a href="#como-funciona">¿Cómo funciona?</a>
              ) : (
                <Link to="/#como-funciona">¿Cómo funciona?</Link>
              )}
            </li>
            <li>
              {isHome ? (
                <a href="#planes">Planes (Base / Pro)</a>
              ) : (
                <Link to="/#planes">Planes (Base / Pro)</Link>
              )}
            </li>
            <li>
              {isHome ? (
                <a href="#faq">Preguntas Frecuentes</a>
              ) : (
                <Link to="/preguntas-frecuentes">Preguntas Frecuentes</Link>
              )}
            </li>
            <li>
              <Link to="/contacto" aria-current={location.pathname === '/contacto' ? 'page' : undefined}>
                Contacto
              </Link>
            </li>
          </ul>

          <div className="header-actions">
            {onOpenAuth ? (
              <>
                <button
                  type="button"
                  onClick={(e) => handleAuthAction(true, e)}
                  className="login-btn-nav"
                >
                  <User size={17} aria-hidden="true" />
                  <span>Iniciar sesión</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleAuthAction(false, e)}
                  className="header-cta-btn"
                >
                  Registrar mi salón
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="login-btn-nav">
                  <User size={17} aria-hidden="true" />
                  <span>Iniciar sesión</span>
                </Link>
                <Link to="/registro" className="header-cta-btn">
                  Registrar mi salón
                </Link>
              </>
            )}
          </div>

          <button
            type="button"
            className="mobile-menu-btn"
            aria-label={mobileMenuOpen ? 'Cerrar menú de navegación' : 'Abrir menú de navegación'}
            aria-expanded={mobileMenuOpen}
            aria-controls="public-mobile-nav"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
          >
            {mobileMenuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>
        </nav>

        <div
          id="public-mobile-nav"
          className={`mobile-nav-drawer ${mobileMenuOpen ? 'open' : ''}`}
        >
          <ul className="mobile-nav-list">
            <li>
              <a href="#inicio" onClick={() => setMobileMenuOpen(false)}>Inicio</a>
            </li>
            <li>
              <a href="#modulos" onClick={() => setMobileMenuOpen(false)}>Módulos del Sistema</a>
            </li>
            <li>
              <a href="#como-funciona" onClick={() => setMobileMenuOpen(false)}>¿Cómo funciona?</a>
            </li>
            <li>
              <a href="#planes" onClick={() => setMobileMenuOpen(false)}>Planes Base y Pro</a>
            </li>
            <li>
              <a href="#faq" onClick={() => setMobileMenuOpen(false)}>Preguntas Frecuentes</a>
            </li>
            <li>
              <Link to="/contacto" onClick={() => setMobileMenuOpen(false)}>Contacto</Link>
            </li>
          </ul>

          <div className="mobile-nav-actions">
            {onOpenAuth ? (
              <>
                <button
                  type="button"
                  onClick={(e) => handleAuthAction(true, e)}
                  className="login-btn-nav"
                >
                  <User size={16} aria-hidden="true" />
                  <span>Iniciar sesión</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleAuthAction(false, e)}
                  className="header-cta-btn"
                >
                  Registrar mi salón
                </button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={() => setMobileMenuOpen(false)} className="login-btn-nav">
                  <User size={16} aria-hidden="true" />
                  <span>Iniciar sesión</span>
                </Link>
                <Link to="/registro" onClick={() => setMobileMenuOpen(false)} className="header-cta-btn">
                  Registrar mi salón
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export const PublicFooter = () => (
  <footer className="landing-footer" style={{ marginTop: 'auto' }}>
    <div className="container">
      <div className="footer-grid">
        <div className="footer-brand">
          <div className="logo">
            <Link to="/">
              PLAN<span>BEAUTY</span>SAAS
            </Link>
          </div>
          <p>
            Plataforma SaaS Multi-Tenant para salones de belleza y centros estéticos: POS de recepción, facturación fiscal DGII, nómina, comisiones y membresías recurrentes.
          </p>
        </div>

        <div className="footer-links-col">
          <h3>Plataforma SaaS</h3>
          <ul>
            <li><a href="/#modulos">Módulos y POS</a></li>
            <li><a href="/#planes">Plan Base ($49/mes)</a></li>
            <li><a href="/#planes">Plan Pro ($99/mes)</a></li>
            <li><a href="/#faq">Preguntas Frecuentes</a></li>
          </ul>
        </div>

        <div className="footer-links-col">
          <h3>Legal y Soporte</h3>
          <ul>
            <li><Link to="/terminos-y-condiciones">Términos y condiciones</Link></li>
            <li><Link to="/politica-de-privacidad">Política de privacidad</Link></li>
            <li><Link to="/cancelacion-y-reembolsos">Cancelación y reembolsos</Link></li>
            <li><Link to="/contacto">Contacto comercial</Link></li>
          </ul>
        </div>

        <div className="footer-contact">
          <h3>Soporte Comercial</h3>
          <p>
            <MapPin size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: '3px' }} />
            <span>Santo Domingo, República Dominicana</span>
          </p>
          <a href="tel:+18095615000">
            <Phone size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: '3px' }} />
            <span>(809) 561-5000</span>
          </a>
          <a href="mailto:hola@planbeautyrd.com">
            <Mail size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: '3px' }} />
            <span>hola@planbeautyrd.com</span>
          </a>
        </div>
      </div>

      <div className="footer-bottom">
        <p style={{ margin: 0 }}>
          &copy; 2026 Plan Beauty SaaS &mdash; Sistema Integral para Salones de Belleza. Todos los derechos reservados.
        </p>
      </div>
    </div>
  </footer>
);
