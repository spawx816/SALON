const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

async function testAllSixCases() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '-04:00'
  });

  const getDRDateKey = (timestamp) => {
    if (!timestamp) return '';
    if (typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(timestamp.trim())) {
      return timestamp.trim();
    }
    try {
      const d = new Date(timestamp);
      if (isNaN(d.getTime())) return String(timestamp).slice(0, 10);
      return d.toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' });
    } catch (e) {
      return String(timestamp).slice(0, 10);
    }
  };

  const getDRHour = (timestamp) => {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', hour: 'numeric', hourCycle: 'h23' });
      return parseInt(formatter.format(new Date(timestamp)), 10);
    } catch (e) {
      return new Date(timestamp).getHours();
    }
  };

  const getDRMinute = (timestamp) => {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', minute: 'numeric' });
      return parseInt(formatter.format(new Date(timestamp)), 10);
    } catch (e) {
      return new Date(timestamp).getMinutes();
    }
  };

  const getDRDayOfWeek = (timestamp) => {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', weekday: 'short' });
      return formatter.format(new Date(timestamp));
    } catch (e) {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return days[new Date(timestamp).getDay()];
    }
  };

  // Test 1: Marcelle on Oct 20 date key
  console.log('--- TEST 1: Marcelle Date Keys ---');
  const cin20 = '2026-10-20T16:56:08.000Z'; // 12:56 PM DR
  const cout20 = '2026-10-21T00:01:52.000Z'; // 8:01 PM DR
  console.log('Check-In DR Date:', getDRDateKey(cin20));
  console.log('Check-Out DR Date:', getDRDateKey(cout20));
  console.log('Are both on 2026-10-20?', getDRDateKey(cin20) === '2026-10-20' && getDRDateKey(cout20) === '2026-10-20' ? 'YES (FIXED)' : 'NO (BUG)');

  // Test 2: Marcelle on Oct 16 closing exception
  console.log('\n--- TEST 2: Marcelle Oct 16 (Exit at 7:30 PM) ---');
  const cout16 = '2026-10-16T23:30:26.000Z'; // 7:30:26 PM DR
  const outHour16 = getDRHour(cout16);
  const outMinute16 = getDRMinute(cout16);
  const outDay16 = getDRDayOfWeek(cout16);
  const outClockMins16 = outHour16 * 60 + outMinute16;
  const closingCutoffMins16 = (outDay16 === 'Sat') ? 1080 : (outDay16 === 'Sun') ? 1020 : 1200; // 1200 = 20:00 (8:00 PM)
  const schedSalMins16 = 21 * 60; // 9:00 PM
  const effectiveSalMins16 = Math.min(schedSalMins16, closingCutoffMins16); // 1200
  const isEarlyExit16 = outClockMins16 < effectiveSalMins16;
  const salidaAnticipada16 = isEarlyExit16 ? (effectiveSalMins16 - outClockMins16) : 0;
  console.log(`outClock: ${outHour16}:${outMinute16} (${outClockMins16}m), target: ${effectiveSalMins16}m (8:00 PM)`);
  console.log(`Is early exit? ${isEarlyExit16} (${salidaAnticipada16} mins early) -> Should be TRUE (30m early): ${isEarlyExit16 && salidaAnticipada16 === 30 ? 'PERFECT' : 'WRONG'}`);

  // Test 3: Johanny Oct 16 (In 8:12, Out 17:10)
  console.log('\n--- TEST 3: Johanny Oct 16 (In 8:12, Out 17:10) ---');
  const inJ16 = 8 * 60 + 12;
  const outJ16 = 17 * 60 + 10;
  const schedInJ = 8 * 60;
  const schedSalJ = 17 * 60;
  const rawDelayJ16 = inJ16 - schedInJ; // 12
  const tardanzaEntradaJ16 = rawDelayJ16 > 15 ? rawDelayJ16 : 0; // 0
  const earlyExitJ16 = outJ16 < schedSalJ ? (schedSalJ - outJ16) : 0; // 0
  console.log(`tardanzaEntrada: ${tardanzaEntradaJ16}m, earlyExit: ${earlyExitJ16}m -> Total deduction: ${tardanzaEntradaJ16 + earlyExitJ16}m -> Expected: 0m: ${tardanzaEntradaJ16 + earlyExitJ16 === 0 ? 'PERFECT' : 'WRONG'}`);

  // Test 4: Lateness > 15 min with compensation (Arrive 8:20, Leave 17:10)
  console.log('\n--- TEST 4: Delay 20 min (exceeded 15), Leave 17:10 ---');
  const inLate = 8 * 60 + 20;
  const outComp = 17 * 60 + 10;
  const rawDelayLate = inLate - schedInJ; // 20
  const tardanzaEntradaLate = rawDelayLate > 15 ? rawDelayLate : 0; // 20
  const extraAtExit = Math.max(0, outComp - schedSalJ); // 10
  const compensated = Math.min(tardanzaEntradaLate, extraAtExit); // 10
  const remainingLateness = tardanzaEntradaLate - compensated; // 10
  console.log(`rawDelay: ${rawDelayLate}m, tardanzaEntrada: ${tardanzaEntradaLate}m, extraAtExit: ${extraAtExit}m, compensated: ${compensated}m, netLateness: ${remainingLateness}m -> Expected: 10m: ${remainingLateness === 10 ? 'PERFECT' : 'WRONG'}`);

  // Test 5: Ashly on Tuesday Oct 20 (Day Off worked)
  console.log('\n--- TEST 5: Ashly Day Off Worked ---');
  const inA20 = 8 * 60 + 21;
  const outA20 = 12 * 60 + 18;
  const workedMinsA20 = outA20 - inA20; // 237
  const dayOvertimeMinsA20 = workedMinsA20 * 2; // 474
  const dayLatenessMinsA20 = 0;
  console.log(`Worked mins: ${workedMinsA20}m, Paid mins (2.0x): ${dayOvertimeMinsA20}m, Lateness: ${dayLatenessMinsA20}m -> Expected: 474m paid, 0 lateness: ${dayOvertimeMinsA20 === 474 && dayLatenessMinsA20 === 0 ? 'PERFECT' : 'WRONG'}`);

  await pool.end();
}

testAllSixCases().catch(console.error);
