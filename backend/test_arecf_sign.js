const sampleMultipart = `------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="xml"; filename="101023122E3100000045.xml"
Content-Type: text/xml

<?xml version="1.0" encoding="utf-8"?>
<ECF>
  <Encabezado>
    <IdDoc>
      <eNCF>E31000000045</eNCF>
    </IdDoc>
    <Emisor>
      <RNCEmisor>101023122</RNCEmisor>
    </Emisor>
    <Comprador>
      <RNCComprador>131917038</RNCComprador>
    </Comprador>
  </Encabezado>
</ECF>
------WebKitFormBoundary7MA4YWxkTrZu0gW--`;

function extractXmlTag(xml, tag) {
  if (!xml || typeof xml !== 'string') return '';
  const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}[^>]*>([^<]+)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function extractEcfDetails(rawBody) {
  let text = '';
  if (typeof rawBody === 'string') {
    text = rawBody;
  } else if (rawBody && typeof rawBody === 'object') {
    text = JSON.stringify(rawBody);
  } else if (Buffer.isBuffer(rawBody)) {
    text = rawBody.toString('utf8');
  }

  // 1. Extract from XML tags
  let encf = extractXmlTag(text, 'eNCF') || extractXmlTag(text, 'encf') || extractXmlTag(text, 'e-NCF') || extractXmlTag(text, 'NCF');
  
  // 2. Extract from filename header (e.g. filename="101023122E3100000045.xml")
  if (!encf) {
    const filenameMatch = text.match(/filename=["']?(?:\d{9,11})?(E\d{10,13})\.xml/i);
    if (filenameMatch) encf = filenameMatch[1].toUpperCase();
  }

  // 3. Extract from regex pattern anywhere in text
  if (!encf) {
    const encfRegex = /\b(E(?:31|32|33|34|41|43|44|45|46|47|48)\d{10})\b/i;
    const m = text.match(encfRegex);
    if (m) encf = m[1].toUpperCase();
  }

  let rncEmisor = extractXmlTag(text, 'RNCEmisor') || extractXmlTag(text, 'rncEmisor');
  if (!rncEmisor) {
    const filenameMatch = text.match(/filename=["']?(\d{9,11})E\d/i);
    if (filenameMatch) rncEmisor = filenameMatch[1];
  }

  let rncComprador = extractXmlTag(text, 'RNCComprador') || extractXmlTag(text, 'rncComprador');
  if (!rncComprador) {
    rncComprador = '131917038';
  }

  return { encf, rncEmisor, rncComprador };
}

console.log('Parsed:', extractEcfDetails(sampleMultipart));
