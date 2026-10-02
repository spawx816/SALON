import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';

/**
 * Standard, ISO/IEC 18004 compliant QR Code Generator for POS and Invoices.
 * Scannable by any mobile camera / barcode reader.
 */
export function QRCodeSVG({ value, size = 68, className = '', style = {}, level = 'M', includeMargin = false }) {
  const [svgString, setSvgString] = useState('');

  useEffect(() => {
    if (!value) {
      setSvgString('');
      return;
    }
    QRCode.toString(String(value), {
      type: 'svg',
      margin: includeMargin ? 1 : 0,
      errorCorrectionLevel: level || 'M',
      width: size
    }, (err, string) => {
      if (!err && string) {
        setSvgString(string);
      }
    });
  }, [value, size, level, includeMargin]);

  if (!svgString) {
    return (
      <div 
        style={{ 
          width: size, 
          height: size, 
          background: '#ffffff', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          ...style 
        }} 
        className={className}
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style
      }}
      dangerouslySetInnerHTML={{ __html: svgString }}
    />
  );
}

export function QRCodeCanvas(props) {
  return <QRCodeSVG {...props} />;
}

export default QRCodeSVG;
