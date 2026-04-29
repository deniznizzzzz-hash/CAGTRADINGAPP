// IATA → display name used in the Flight Table Excel.
// Values match the existing sheet conventions (plain ASCII, title case).
const AIRPORTS = {
  BRU: 'Brussels',
  CRL: 'Charleroi',
  SAW: 'Sabiha Gokcen',
  IST: 'Istanbul',
  AYT: 'Antalya',
  ESB: 'Ankara',
  ADB: 'Izmir',
  ADA: 'Adana',
  COV: 'Cukurova',
  TZX: 'Trabzon',
  AOE: 'Eskisehir',
  ESK: 'Eskisehir',
  DLM: 'Dalaman',
  BJV: 'Bodrum',
  GZT: 'Gaziantep',
  DUS: 'Dusseldorf',
  EIN: 'Eindhoven',
  AMS: 'Amsterdam',
  BHX: 'Birmingham',
  LYS: 'Lyon',
  IAS: 'Iasi',
  JNB: 'Johannesburg',
  MUC: 'Munich',
  FRA: 'Frankfurt',
  CGN: 'Cologne',
  STR: 'Stuttgart',
  VIE: 'Vienna',
  ZRH: 'Zurich',
  LHR: 'London',
  LGW: 'London',
  STN: 'London',
  LCY: 'London',
  LTN: 'London',
  OGU: 'Ordu-Giresun',
  MAN: 'Manchester',
  CDG: 'Paris',
  ORY: 'Paris',
  BCN: 'Barcelona',
  MAD: 'Madrid',
  FCO: 'Rome',
  MXP: 'Milan',
  ATH: 'Athens',
  SOF: 'Sofia',
  OTP: 'Bucharest',
  BLQ: 'Bologna',
  HEL: 'Helsinki',
  LIN: 'Milan Linate'
};

function airportFromIATA(code) {
  if (!code) return '';
  const up = code.toUpperCase().trim();
  return AIRPORTS[up] || up;
}

module.exports = { AIRPORTS, airportFromIATA };
