// The demo's sample nonprofit: Copper Hollow Food Pantry, its small team and
// the people who give to it. Every name, address and email is invented
// (example.* domains, 555-01xx numbers). Gifts are [days ago, dollars, extra];
// monthly givers came in through the Stripe move-in.

export const organization = { name: 'Copper Hollow Food Pantry', ein: '83-4419072', timezone: 'America/New_York' }
export const ownerName = 'Dana Whitfield'
export const team = [
 { id: 'demo-op-marcus', email: 'marcus.reyes@copperhollowpantry.example', name: 'Marcus Reyes', role: 'admin', joined: 330 },
 { id: 'demo-op-june', email: 'june.albright@copperhollowpantry.example', name: 'June Albright', role: 'member', joined: 300 },
] as const
export const agentKeys = [
 { id: 'demo-agent-spring', label: 'Weekly letters assistant', created: 48 },
 { id: 'demo-agent-fall', label: 'Letters and appeals assistant', created: 12 },
]

export type Extra = { fund?: string; method?: string; ref?: string; note?: string; goods?: [number, string]; pledge?: string; reversed?: [number, string]; stripe?: boolean }
export type Gift = [number, number, Extra?]
export type Consent = 'yes' | 'no' | 'withdrawn'
export type DonorSeed = {
 key: string; name: string; email?: string; phone?: string; street?: string; city?: string; zip?: string; household?: string
 since: number; email_consent?: Consent; mail_consent?: Consent; gifts?: Gift[]
 monthly?: { dollars: number; day: number; months: number; customer: string }
 pledges?: { key: string; dollars: number; pledged: number; dueIn: number; fund: string }[]
}

const B = 'Weekend Backpacks', M = 'Mobile Pantry', H = 'Holiday Meals', W = 'Warehouse Fund', K = 'In-kind'
const check = (ref: string, fund?: string, pledge?: string): Extra => ({ method: 'check', ref, fund, pledge })
const dinner = (seats: number): Extra => ({ method: 'card', fund: 'Harvest Supper', goods: [seats * 6000, `${seats} Harvest Supper dinner ${seats === 1 ? 'ticket' : 'tickets'}`] })

export const donors: DonorSeed[] = [
 { key: 'okafor-adaeze', name: 'Adaeze Okafor', email: 'adaeze.okafor@example.com', phone: '(937) 555-0142', street: '418 Linden Ave', city: 'Copper Hollow', zip: '45387', household: 'Okafor household', since: 360, email_consent: 'yes', mail_consent: 'yes',
  gifts: [[352, 500, check('2231', H)], [190, 250, check('2298', B)], [44, 1000, check('2340', H)]] },
 { key: 'okafor-chidi', name: 'Chidi Okafor', email: 'chidi.okafor@example.com', street: '418 Linden Ave', city: 'Copper Hollow', zip: '45387', household: 'Okafor household', since: 200, email_consent: 'yes',
  gifts: [[61, 150, dinner(1)]] },
 { key: 'martinez-hale', name: 'Rosa Martinez-Hale', email: 'rosa.mh@example.net', phone: '(937) 555-0118', street: '27 Orchard Row', city: 'Yellow Springs', zip: '45387', household: 'Martinez-Hale household', since: 365, email_consent: 'yes', mail_consent: 'yes',
  monthly: { dollars: 50, day: 3, months: 12, customer: 'cus_Qd71RosaMH' } },
 { key: 'hale-thomas', name: 'Thomas Hale', email: 'tom.hale@example.net', street: '27 Orchard Row', city: 'Yellow Springs', zip: '45387', household: 'Martinez-Hale household', since: 120, mail_consent: 'yes',
  gifts: [[61, 300, dinner(2)], [6, 1000, check('5517', W)]] },
 { key: 'brennan', name: 'Eileen Brennan', email: 'eileen.brennan@example.org', phone: '(937) 555-0164', street: '903 Mill Street', city: 'Copper Hollow', zip: '45387', since: 365, email_consent: 'yes', mail_consent: 'yes',
  monthly: { dollars: 25, day: 12, months: 12, customer: 'cus_Qd71Brennan' } },
 { key: 'nguyen-linh', name: 'Linh Nguyen', email: 'linh.nguyen@example.com', street: '15 Sycamore Ct', city: 'Xenia', zip: '45385', since: 280, email_consent: 'yes', mail_consent: 'withdrawn',
  monthly: { dollars: 35, day: 20, months: 9, customer: 'cus_Qd71LinhNg' } },
 { key: 'patel', name: 'Vikram and Anjali Patel', email: 'patel.family@example.com', phone: '(937) 555-0137', street: '2210 Ridgeview Dr', city: 'Beavercreek', zip: '45434', since: 365, email_consent: 'yes', mail_consent: 'yes',
  gifts: [[340, 2500, check('1188', W, 'patel-warehouse')], [250, 2500, check('1201', W, 'patel-warehouse')], [160, 2500, check('1219', W, 'patel-warehouse')], [70, 2500, check('1240', W, 'patel-warehouse')]], pledges: [{ key: 'patel-warehouse', dollars: 15000, pledged: 345, dueIn: 380, fund: W }] },
 { key: 'kowalski', name: 'Gary Kowalski', email: 'gkowalski@example.org', street: '77 Depot St', city: 'Copper Hollow', zip: '45387', since: 330, mail_consent: 'yes',
  gifts: [[325, 40, { method: 'cash', fund: B }], [212, 60, { method: 'cash' }], [96, 40, { method: 'cash', fund: B }], [21, 75, { method: 'cash', fund: H }]] },
 { key: 'abernathy', name: 'Louise Abernathy', email: 'louise.abernathy@example.com', phone: '(937) 555-0101', street: '5 Church Lane', city: 'Copper Hollow', zip: '45387', since: 365, email_consent: 'no', mail_consent: 'yes',
  gifts: [[300, 100, check('3305')], [182, 100, check('3341')], [92, 100, check('3366')], [12, 300, check('3390', H)]] },
 { key: 'sato', name: 'Kenji Sato', email: 'kenji.sato@example.net', street: '64 Hawthorn Ave', city: 'Fairborn', zip: '45324', since: 240, email_consent: 'yes',
  monthly: { dollars: 20, day: 8, months: 8, customer: 'cus_Qd71KenjiS' } },
 { key: 'washington', name: 'Denise Washington', email: 'denise.w@example.com', phone: '(937) 555-0159', street: '311 Maple Grove Rd', city: 'Copper Hollow', zip: '45387', household: 'Washington household', since: 365, email_consent: 'yes', mail_consent: 'yes',
  gifts: [[330, 250, check('4410', H)], [240, 300, check('4431', B)], [61, 1000, { ...dinner(8), note: 'Table sponsor' }], [15, 500, check('4472', B)]] },
 { key: 'washington-earl', name: 'Earl Washington', street: '311 Maple Grove Rd', city: 'Copper Hollow', zip: '45387', household: 'Washington household', since: 330, mail_consent: 'yes',
  gifts: [[110, 100, { method: 'cash', fund: M }]] },
 { key: 'fischer', name: 'Greta Fischer', email: 'greta.fischer@example.org', street: '18 Clifton Pike', city: 'Yellow Springs', zip: '45387', since: 300, email_consent: 'withdrawn', mail_consent: 'yes',
  gifts: [[290, 75, { method: 'online' }], [282, 300, { method: 'online', fund: H }], [130, 75, { method: 'online', fund: M }]] },
 { key: 'oconnell', name: 'Brendan O’Connell', email: 'brendan.oconnell@example.com', since: 260, email_consent: 'yes',
  monthly: { dollars: 100, day: 27, months: 8, customer: 'cus_Qd71Brendn' } },
 { key: 'rahman', name: 'Farah Rahman', email: 'farah.rahman@example.net', phone: '(937) 555-0173', street: '940 Walnut St', city: 'Dayton', zip: '45402', since: 210, email_consent: 'yes', mail_consent: 'yes',
  gifts: [[205, 250, { method: 'online', fund: B }], [61, 300, dinner(2)], [8, 750, { method: 'online', fund: H }]] },
 { key: 'lindqvist', name: 'Erik Lindqvist', email: 'erik.lindqvist@example.org', street: '3 Quarry Rd', city: 'Copper Hollow', zip: '45387', since: 365, mail_consent: 'yes',
  gifts: [[358, 5000, { ...check('7781', W), note: 'In memory of Ingrid Lindqvist' }], [175, 1000, check('7802', M)]] },
 { key: 'delgado', name: 'Marisol Delgado', email: 'marisol.delgado@example.com', since: 190, email_consent: 'yes',
  monthly: { dollars: 15, day: 15, months: 6, customer: 'cus_Qd71Marisl' } },
 { key: 'tran', name: 'Huy and Mai Tran', email: 'tran.household@example.net', street: '88 Kettering Blvd', city: 'Kettering', zip: '45429', since: 150, email_consent: 'yes', mail_consent: 'yes',
  gifts: [[148, 500, { method: 'bank transfer', fund: M }], [105, 300, { method: 'card', fund: M }], [17, 500, { method: 'card', fund: H }]] },
 { key: 'whitaker', name: 'Rev. Ellen Whitaker', email: 'ewhitaker@example.org', phone: '(937) 555-0126', street: '120 Main St', city: 'Copper Hollow', zip: '45387', since: 320, email_consent: 'yes', mail_consent: 'yes',
  gifts: [[315, 50, check('1015')], [300, 300, check('1022', H)], [225, 50, check('1033')], [135, 50, check('1050')], [45, 50, check('1068')]] },
 { key: 'first-church', name: 'First Methodist Church of Copper Hollow', email: 'office@firstmethodist-ch.example', phone: '(937) 555-0190', street: '120 Main St', city: 'Copper Hollow', zip: '45387', since: 365, mail_consent: 'yes',
  gifts: [[345, 1200, check('8801', H)], [255, 800, check('8822')], [165, 950, check('8840', B)], [75, 1100, check('8861')], [22, 1400, check('8877', H)]] },
 { key: 'hardware', name: 'Hollow Creek Hardware', email: 'owner@hollowcreekhardware.example', street: '210 Main St', city: 'Copper Hollow', zip: '45387', since: 280, mail_consent: 'yes',
  gifts: [[270, 400, { method: 'other', fund: K, note: 'Shelving and two pallet jacks for the back room (donor’s stated value)' }], [100, 250, check('6230', M)], [30, 300, check('6251', W, 'hardware-warehouse')]], pledges: [{ key: 'hardware-warehouse', dollars: 1200, pledged: 100, dueIn: 200, fund: W }] },
 { key: 'bakery', name: 'Kessler & Daughters Bakery', email: 'hello@kesslerbakery.example', street: '9 Market Square', city: 'Xenia', zip: '45385', since: 240, email_consent: 'yes', mail_consent: 'yes',
  gifts: [[236, 300, { method: 'other', fund: K, note: 'Day-old bread every Friday for August (donor’s stated value)' }], [40, 350, { method: 'other', fund: K, note: 'Pies for the Harvest Supper (donor’s stated value)' }]] },
 { key: 'bellamy', name: 'Bellamy Family Foundation', email: 'grants@bellamyff.example', street: '400 Courthouse Plaza, Suite 1200', city: 'Dayton', zip: '45402', since: 365, mail_consent: 'yes',
  gifts: [[310, 15000, { method: 'bank transfer', fund: B, note: '2025–26 backpack program grant' }], [26, 7500, { method: 'bank transfer', fund: M, note: 'Mobile pantry van, first half' }]] },
 { key: 'credit-union', name: 'Copper Hollow Community Credit Union', email: 'community@chccu.example', street: '55 Main St', city: 'Copper Hollow', zip: '45387', since: 200, mail_consent: 'yes',
  gifts: [[198, 2000, check('90114', H)], [61, 1500, { ...dinner(8), method: 'check', ref: '90177', note: 'Presenting sponsor' }]] },
 { key: 'moreau', name: 'Claire Moreau', email: 'claire.moreau@example.com', since: 175, email_consent: 'yes',
  gifts: [[172, 25, { method: 'online' }], [61, 150, dinner(1)], [3, 250, { method: 'online', fund: H }]] },
 { key: 'jackson-t', name: 'Terrence Jackson', email: 'tjackson@example.net', phone: '(937) 555-0181', street: '602 Elm St', city: 'Springfield', zip: '45503', since: 230, email_consent: 'yes', mail_consent: 'yes',
  gifts: [[228, 200, { method: 'card', reversed: [226, 'Duplicate card charge refunded to donor'] }], [227, 200, { method: 'card', fund: B }], [55, 400, { method: 'card', fund: H }]] },
 { key: 'gallagher', name: 'Siobhan Gallagher', email: 'siobhan.g@example.org', since: 140, email_consent: 'withdrawn', mail_consent: 'no',
  gifts: [[138, 60, { method: 'online' }], [31, 60, { method: 'online' }]] },
 { key: 'yoder', name: 'Amos Yoder', street: 'RR 2 Box 41', city: 'Copper Hollow', zip: '45387', since: 300, mail_consent: 'yes',
  gifts: [[296, 250, { method: 'other', fund: K, note: 'Forty bushels of sweet corn (donor’s stated value)' }], [120, 400, { method: 'other', fund: K, note: 'Potatoes and winter squash (donor’s stated value)' }], [9, 300, { method: 'other', fund: K, note: 'Apples from the orchard (donor’s stated value)' }]] },
 { key: 'cohen', name: 'Miriam Cohen', email: 'miriam.cohen@example.com', phone: '(937) 555-0133', street: '47 Grinnell Rd', city: 'Yellow Springs', zip: '45387', since: 365, email_consent: 'yes', mail_consent: 'yes',
  gifts: [[355, 1000, check('2602', H)], [5, 1000, check('2655', H)]] },
 { key: 'park', name: 'Daniel Park', email: 'daniel.park@example.net', since: 120, email_consent: 'yes',
  monthly: { dollars: 30, day: 1, months: 4, customer: 'cus_Qd71DanPrk' } },
 { key: 'ruiz', name: 'Carmen Ruiz', email: 'carmen.ruiz@example.com', street: '19 Spring St', city: 'Fairborn', zip: '45324', since: 260, email_consent: 'yes', mail_consent: 'yes',
  gifts: [[258, 100, { method: 'online', fund: B }], [215, 300, { method: 'online', fund: B }], [61, 150, dinner(1)]] },
 { key: 'albright-h', name: 'Harold Albright', street: '402 Corry St', city: 'Yellow Springs', zip: '45387', since: 300, mail_consent: 'yes',
  gifts: [[298, 150, check('613', B)], [150, 150, check('629', B)], [28, 200, { ...check('640', H), reversed: [20, 'Check returned unpaid by the bank'] }]] },
 { key: 'mbeki', name: 'Thandiwe Mbeki', email: 'thandiwe.mbeki@example.org', since: 90, email_consent: 'yes', mail_consent: 'yes', street: '71 Xenia Ave', city: 'Yellow Springs', zip: '45387',
  gifts: [[88, 100, { method: 'online', fund: M }], [61, 300, dinner(2)]] },
 { key: 'lambert', name: 'Paul Lambert', email: 'paul.lambert@example.com', since: 365, email_consent: 'yes',
  monthly: { dollars: 10, day: 22, months: 12, customer: 'cus_Qd71PaulLb' } },
 { key: 'hughes', name: 'Margaret Hughes', email: 'peggy.hughes@example.net', phone: '(937) 555-0167', street: '8 Wren Ct', city: 'Beavercreek', zip: '45434', since: 365, mail_consent: 'yes',
  gifts: [[349, 250, check('7740', H)], [17, 500, { method: 'card', fund: H, ref: 'ch_3QfP2mHughes0917', note: 'Fall food drive', stripe: true }]] },
 { key: 'osei', name: 'Kwame Osei', email: 'kwame.osei@example.com', since: 60, email_consent: 'yes',
  gifts: [[58, 100, { method: 'online', fund: B }]] },
 { key: 'ferraro', name: 'Angela Ferraro', email: 'angela.ferraro@example.org', street: '1104 Wilmington Pike', city: 'Kettering', zip: '45420', since: 310, mail_consent: 'yes', email_consent: 'yes',
  gifts: [[305, 500, check('3021', W, 'ferraro-warehouse')], [120, 500, check('3068', W, 'ferraro-warehouse')], [61, 600, { ...dinner(4), note: 'Bought a half table' }]], pledges: [{ key: 'ferraro-warehouse', dollars: 3000, pledged: 305, dueIn: 400, fund: W }] },
 { key: 'bauer', name: 'Wendell Bauer', street: '33 Hillcrest Dr', city: 'Copper Hollow', zip: '45387', since: 200, mail_consent: 'withdrawn',
  gifts: [[196, 35, { method: 'cash' }]] },
 { key: 'singh', name: 'Harpreet Singh', email: 'harpreet.singh@example.net', since: 45, email_consent: 'yes',
  gifts: [[43, 250, { method: 'online', fund: H }], [2, 300, { method: 'card', fund: H, ref: 'ch_3QfP9xSingh1014', note: 'Fall food drive', stripe: true }]] },
 { key: 'murray', name: 'Joan Murray', email: 'joan.murray@example.com', street: '250 Dayton St', city: 'Yellow Springs', zip: '45387', since: 365, email_consent: 'yes', mail_consent: 'yes',
  monthly: { dollars: 40, day: 10, months: 12, customer: 'cus_Qd71JoanMu' } },
 { key: 'novak', name: 'Petra Novak', email: 'petra.novak@example.org', since: 20, mail_consent: 'yes', street: '16 Center St', city: 'Cedarville', zip: '45314',
  gifts: [[18, 50, check('118', H)]] },
]

