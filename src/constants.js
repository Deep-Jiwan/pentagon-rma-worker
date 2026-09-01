// Must stay in the exact same order as the header row created by
// setup_rma_tracker.gs — this is what maps sheet columns A..Y to
// named fields on both read and write. Adding a field here means adding
// the matching header cell to the Open, Closed and Master tabs and
// bumping LAST_COL below, or reads and writes shear by one column.
export const HEADERS = [
  'RMA ID',
  'SN',
  'Customer Name',
  'Mobile Number',
  'Invoice Number',
  'Purchase Date',
  'Model Number',
  'Product Type',
  'Brand',
  'Problem Description',
  'Technician Name',
  'Date In',
  'Warranty Status',
  'Status',
  'Resolution',
  'Repair/Replacement Details',
  'Date Out',
  'Collected By Name',
  'Collector Mobile Number',
  'Red Flag',
  'Red Flag Reason',
  'Additional Details',
  'Last Edited Timestamp',
  // Records that a technician *pressed send* on a WhatsApp message for this
  // ticket — not that WhatsApp delivered it. Sending happens entirely on the
  // technician's phone (an OS share sheet or a whatsapp:// deep link), and
  // neither route reports back, so this is the strongest signal available
  // without moving to the WhatsApp Business Cloud API. Stamped by
  // POST /tickets/:rmaId/whatsapp-sent.
  'Last WhatsApp Sent',
  'Last WhatsApp Type'
];

export const LAST_COL = 'Y'; // 25th letter — last column, must match HEADERS.length
