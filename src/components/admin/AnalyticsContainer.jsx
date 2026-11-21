import React from 'react';
import ServiceAnalytics from './ServiceAnalytics';
import BusinessIntelligence from '../bi/BusinessIntelligence';

/**
 * Contenedor neutro de Analítica y BI.
 * Compone ServiceAnalytics y BusinessIntelligence sin dependencias circulares,
 * preservando rutas (/analitica, /bi, /inteligencia-negocios), pestañas, filtros y permisos.
 */
const AnalyticsContainer = () => {
  return (
    <ServiceAnalytics
      renderBiView={({ onOpenClassicView }) => (
        <BusinessIntelligence
          standalone={false}
          onOpenClassicView={onOpenClassicView}
        />
      )}
    />
  );
};

export default AnalyticsContainer;
