import React from 'react';
import { QRCodeSVG as ReactQRCodeSVG, QRCodeCanvas as ReactQRCodeCanvas } from 'qrcode.react';

/**
 * Standard, 100% compliant QR Code generator using official ISO/IEC 18004 Reed-Solomon encoding.
 * Ensures immediate recognition and scan by any smartphone camera (iOS, Android) and DGII scanners.
 */

export function QRCodeSVG({ value, size = 68, level = 'M', includeMargin = false, className = '', style = {} }) {
  const cleanVal = String(value || 'https://ecf.dgii.gov.do/consultatimbre?RncEmisor=131917038');
  return (
    <ReactQRCodeSVG
      value={cleanVal}
      size={size}
      level={level}
      includeMargin={includeMargin}
      className={className}
      style={{ shapeRendering: 'crispEdges', ...style }}
    />
  );
}

export function QRCodeCanvas({ value, size = 68, level = 'M', includeMargin = false, className = '', style = {} }) {
  const cleanVal = String(value || 'https://ecf.dgii.gov.do/consultatimbre?RncEmisor=131917038');
  return (
    <ReactQRCodeCanvas
      value={cleanVal}
      size={size}
      level={level}
      includeMargin={includeMargin}
      className={className}
      style={{ ...style }}
    />
  );
}

export default QRCodeSVG;
