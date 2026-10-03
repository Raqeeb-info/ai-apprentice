// Shared scenario: an IT helpdesk at a fictional company.
// All names, numbers and companies are fake.

export const EXPERT = {
  name: 'Erik Lund',
  role: 'Senior IT Support',
  years: 22,
  company: 'Nordvik Industrier',
};

export const NEW_HIRE = { name: 'Lena', role: 'IT Support (week 1)' };

export const VERIFICATION_OPTIONS = [
  'Not verified',
  'Callback: number in ticket',
  'Callback: HR directory number',
  'Video call ID check',
  'Manager confirmed in writing',
];

export const ACTION_OPTIONS = [
  '— choose —',
  'Reset password',
  'Reset MFA',
  'Grant local admin (24h)',
  'Grant local admin (permanent)',
  'Grant VPN access',
  'No action',
];

export const STATUS_OPTIONS = ['Open', 'Resolved', 'On hold', 'Escalated to Security'];

// HR directory (the trusted source for phone numbers).
export const HR_DIRECTORY = {
  'Anna Berg': { dept: 'Finance', phone: '+46 70 555 66 77', manager: 'Karl Wik' },
  'Johan Ek': { dept: 'R&D', phone: '+46 70 222 33 44', manager: 'Maria Svensson' },
  'Peter Holm': { dept: 'Executive (CFO)', phone: '+46 70 999 00 11', manager: 'CEO' },
  'Sara Nilsson': { dept: 'Sales (Head of Sales)', phone: '+46 70 444 12 12', manager: 'CEO' },
  'Ali Haddad': { dept: 'R&D', phone: '+46 70 321 45 67', manager: 'Maria Svensson' },
};

// Tickets the EXPERT processes in the Capture session.
export const CAPTURE_TICKETS = [
  {
    id: 'INC-1041',
    title: 'Forgot my password, locked out',
    requester: 'Anna Berg',
    channel: 'Email',
    contactInTicket: '+46 70 111 22 33',
    managerApproval: false,
    body: "Hi, I'm locked out after the holidays. Please reset my password and call me on +46 70 111 22 33. Thanks, Anna",
  },
  {
    id: 'INC-1042',
    title: 'Need admin rights to install Docker',
    requester: 'Johan Ek',
    channel: 'Portal',
    contactInTicket: '',
    managerApproval: true,
    approvalBy: 'Maria Svensson',
    body: 'I need local admin on my laptop to install Docker for the new build pipeline. Approval from Maria attached.',
  },
  {
    id: 'INC-1043',
    title: 'URGENT – CFO locked out of MFA',
    requester: 'Peter Holm (caller says)',
    channel: 'Phone',
    contactInTicket: '+44 7700 900123',
    managerApproval: false,
    body: "Caller says he is Peter Holm, CFO. New phone, MFA app gone, at the airport, board meeting in 1 hour. Very stressed, wants MFA reset NOW. Calling from a UK number.",
  },
];

// Cases the NEW HIRE gets in Teach mode. The expert never showed these.
export const TEACH_TICKETS = [
  {
    id: 'INC-2001',
    title: 'Lost phone – need MFA reset before my flight',
    requester: 'Sara Nilsson (Teams message)',
    channel: 'Teams chat (external account)',
    contactInTicket: '',
    managerApproval: false,
    body: "Hi IT! It's Sara, Head of Sales. Lost my phone, flying to a client in 40 min. Can you reset my MFA so I can set it up on my new phone? Messaging from my private Teams. Super urgent!!",
  },
  {
    id: 'INC-2002',
    title: 'Admin rights for the whole year please',
    requester: 'Ali Haddad',
    channel: 'Portal',
    contactInTicket: '',
    managerApproval: false,
    body: "I install new tools all the time, so please just give me permanent admin on my laptop. Asking Maria for approval felt unnecessary.",
  },
];

// ---------------------------------------------------------------------------
// ANSWER KEY – used ONLY by the offline mock (no API keys) and for testing.
// In live mode the app learns these rules from the expert, not from here.
// ---------------------------------------------------------------------------
export const ANSWER_KEY = {
  guardrails: [
    {
      id: 'G1',
      type: 'stop_and_ask',
      rule: 'Never call back the number written in the ticket. Only use the number in the HR directory.',
      quote: 'Attackers put their own number in the ticket. The HR directory is the only number I trust.',
    },
    {
      id: 'G2',
      type: 'limit',
      rule: 'Local admin is only ever granted for 24 hours, never permanently.',
      quote: 'Permanent admin is how malware spreads. 24 hours, then it expires.',
    },
    {
      id: 'G3',
      type: 'limit',
      rule: 'No manager approval attached means no admin rights. Put the ticket on hold.',
      quote: 'No approval from their manager, no admin. I put it on hold and ask the manager.',
    },
    {
      id: 'G4',
      type: 'stop_and_ask',
      rule: 'Never reset MFA over phone or chat. Urgency plus an executive name is a social engineering red flag: escalate to Security.',
      quote: 'Urgent, a big title, a strange number – that is exactly what an attacker sounds like. I never reset MFA on the phone, I escalate to Security.',
    },
  ],
};

// Rule checks used by the offline mock tutor. Returns null if OK.
export function mockTutorCheck(ticket, state) {
  const action = state.action;
  const status = state.status;
  const verification = state.verification;
  const isMfa = action === 'Reset MFA';
  const remoteChannel = /phone|chat|teams|email/i.test(ticket.channel);

  if (isMfa && remoteChannel && verification !== 'Video call ID check') {
    return { guardrail: 'G4', ask: 'Erik would stop here. Look at the channel and the urgency – why do you think he would not reset this MFA?' };
  }
  if (verification === 'Callback: number in ticket') {
    return { guardrail: 'G1', ask: 'Erik would stop here. Which phone number would he trust, and why not this one?' };
  }
  if (action === 'Grant local admin (permanent)') {
    return { guardrail: 'G2', ask: 'Erik would stop here. Is there a time limit he always uses for admin rights?' };
  }
  if (action && action.startsWith('Grant local admin') && !ticket.managerApproval) {
    return { guardrail: 'G3', ask: 'Erik would stop here. What is missing on this ticket before anyone gets admin?' };
  }
  if (action === 'Reset password' && !['Callback: HR directory number', 'Video call ID check'].includes(verification) && status === 'Resolved') {
    return { guardrail: 'G1', ask: 'Erik would stop here. How did you confirm this is really the employee?' };
  }
  return null;
}
