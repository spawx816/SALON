const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'src', 'components', 'visits', 'VisitRecorder.jsx');
let content = fs.readFileSync(targetPath, 'utf8');

const oldTarget = `          {sequenceAvailability.alerts.map((al, idx) => {
            const isExhausted = al.level === 'exhausted';
            const isCrit5 = al.level === 'critical_5';
            const bg = isExhausted ? '#fef2f2' : (isCrit5 ? '#fff7ed' : '#fefce8');
            const border = isExhausted ? '#f87171' : (isCrit5 ? '#fdba74' : '#fde047');
            const color = isExhausted ? '#991b1b' : (isCrit5 ? '#9a3412' : '#854d0e');
            const icon = isExhausted ? <ShieldAlert size={18} style={{ color: '#dc2626', flexShrink: 0 }} /> : <AlertTriangle size={18} style={{ color: isCrit5 ? '#ea580c' : '#ca8a04', flexShrink: 0 }} />;`;

const newTarget = `          {sequenceAvailability.alerts.map((al, idx) => {
            const isExhausted = al.level === 'exhausted';
            const isCritical = al.level?.startsWith('critical') || al.level === 'critical_2' || al.level === 'critical_5';
            const bg = isExhausted ? '#fef2f2' : (isCritical ? '#fff7ed' : '#fefce8');
            const border = isExhausted ? '#f87171' : (isCritical ? '#fdba74' : '#fde047');
            const color = isExhausted ? '#991b1b' : (isCritical ? '#9a3412' : '#854d0e');
            const icon = isExhausted ? <ShieldAlert size={18} style={{ color: '#dc2626', flexShrink: 0 }} /> : <AlertTriangle size={18} style={{ color: isCritical ? '#ea580c' : '#ca8a04', flexShrink: 0 }} />;`;

// Normalize line endings for replacement
const normalize = str => str.replace(/\r\n/g, '\n');
const normalizedContent = normalize(content);
const normalizedOld = normalize(oldTarget);
const normalizedNew = normalize(newTarget);

if (!normalizedContent.includes(normalizedOld)) {
  console.error('Target in VisitRecorder.jsx not found!');
  process.exit(1);
}

const updated = normalizedContent.replace(normalizedOld, normalizedNew);
fs.writeFileSync(targetPath, updated, 'utf8');
console.log('✅ Successfully updated src/components/visits/VisitRecorder.jsx');

