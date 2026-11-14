import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import '../../pages/LandingEtereas.css';

const EtereasLogoMark = () => (
  <svg className="et-brand-symbol" viewBox="0 0 40 40" aria-hidden="true">
    <path fill="#2563eb" d="M8 5h26l-6 8H8a4 4 0 0 1 0-8Z" />
    <path fill="#5a55ed" d="M8 16h22l-6 8H8a4 4 0 0 1 0-8Z" />
    <path fill="#8b62f2" d="M8 27h26l-6 8H8a4 4 0 0 1 0-8Z" />
  </svg>
);

export const PublicHeader = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <header className="et-header">
      <div className="et-container et-header-inner">
        <Link to="/" className="et-brand" aria-label="Etereas Inicio" onClick={() => setMobileMenuOpen(false)}>
          <EtereasLogoMark />
          <span>etereas.</span>
        </Link>

        <nav className="et-nav" aria-label="Navegación principal">
          <Link to="/#integracion" className="et-nav-link">
            La plataforma
          </Link>
          <Link to="/#planes" className="et-nav-link">
            Plan y precio
          </Link>
          <Link
            to="/contacto"
            className="et-nav-link"
            aria-current={location.pathname === '/contacto' ? 'page' : undefined}
          >
            Contacto
          </Link>
          <Link to="/login" className="et-nav-link">
            Iniciar sesión
          </Link>
          <Link to="/registro" className="et-btn-primary">
            Contratar →
          </Link>
        </nav>

        <div className="et-mobile-controls">
          <Link to="/login" className="et-mobile-login-pill" onClick={() => setMobileMenuOpen(false)}>
            Iniciar sesión
          </Link>
          <button
            type="button"
            className="et-mobile-menu-btn"
            aria-label={mobileMenuOpen ? 'Cerrar menú de navegación' : 'Abrir menú de navegación'}
            aria-expanded={mobileMenuOpen}
            aria-controls="et-public-mobile-drawer"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
          >
            {mobileMenuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div
        id="et-public-mobile-drawer"
        className={`et-mobile-drawer ${mobileMenuOpen ? 'open' : ''}`}
      >
        <Link to="/#integracion" onClick={() => setMobileMenuOpen(false)}>
          La plataforma
        </Link>
        <Link to="/#planes" onClick={() => setMobileMenuOpen(false)}>
          Plan y precio
        </Link>
        <Link to="/contacto" onClick={() => setMobileMenuOpen(false)}>
          Contacto
        </Link>
        <Link to="/login" onClick={() => setMobileMenuOpen(false)}>
          Iniciar sesión
        </Link>
        <Link to="/registro" className="et-btn-primary" onClick={() => setMobileMenuOpen(false)}>
          Contratar →
        </Link>
      </div>
    </header>
  );
};

export const PublicFooter = () => (
  <>
    <div className="et-prefooter">
      ¿Quieres conocerlo antes?
      <Link to="/contacto">Solicitar demostración</Link>
    </div>
    <footer className="et-footer" style={{ background: '#ffffff' }}>
      <div className="et-container et-footer-inner">
        <Link to="/" className="et-brand" style={{ fontSize: '18px' }}>
          <EtereasLogoMark />
          <span>etereas.</span>
        </Link>

        <span>Software de gestión empresarial</span>

        <div className="et-footer-links">
          <Link to="/contacto">Contacto</Link>
          <Link to="/terminos-y-condiciones">Términos y condiciones</Link>
          <Link to="/politica-de-privacidad">Privacidad</Link>
          <Link to="/cancelacion-y-reembolsos">Cancelación y reembolsos</Link>
        </div>
      </div>
    </footer>
  </>
);
