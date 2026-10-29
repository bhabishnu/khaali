// Upload fields Khali knows. Shared by the content script (spotting fields) and settings (Khali Locker types).
// Order matters, first match wins: "Photo ID proof" is identity, "Passport-size photo" is a photo,
// and "Higher secondary" is class 12, not class 10.
// locker: true means the document can be kept in the Khali Locker on Google Drive.
const FILES = [
  { kind: 'aadhaar', label: 'Aadhaar card', locker: true, re: /aadhaa?r|identity\s*proof|id\s*proof|proof\s*of\s*identity|\bpoi\b/i },
  { kind: 'pan', label: 'PAN card', locker: true, re: /\bpan\b|permanent\s*account/i },
  { kind: 'signature', label: 'Signature', re: /signature|\bsign\b|हस्ताक्षर/i, max: 20, side: 400 },
  { kind: 'photo', label: 'Photo', re: /photo|picture|फोटो/i, max: 50, side: 600 },
  { kind: 'passport', label: 'Passport', locker: true, re: /passport/i },
  { kind: 'dl', label: 'Driving licence', locker: true, re: /driving\s*licen[cs]e/i },
  { kind: 'voter', label: 'Voter ID', locker: true, re: /voter|\bepic\b|election\s*card/i },
  { kind: 'class12', label: 'Class 12 marksheet', locker: true, re: /12th|class\s*(xii|12)\b|higher\s*secondary|\bhsc\b|intermediate/i },
  { kind: 'class10', label: 'Class 10 marksheet', locker: true, re: /10th|class\s*(x|10)\b|matric|\bsslc\b|secondary\s*school/i },
  { kind: 'address', label: 'Address proof', locker: true, re: /address\s*proof|proof\s*of\s*address|\bpoa\b|utility\s*bill|electricity\s*bill/i },
  { kind: 'caste', label: 'Caste certificate', locker: true, re: /caste|community\s*certificate/i },
  { kind: 'income', label: 'Income certificate', locker: true, re: /income\s*certificate/i },
];
