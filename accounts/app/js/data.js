/* ===================== persistence ===================== */
const DB = {
  k:{accounts:'mgr_accounts', session:'mgr_session', biz:'mgr_businesses', users:'mgr_users'},
  get(key,def){ try{ return JSON.parse(localStorage.getItem(key)) ?? def }catch(e){ return def } },
  set(key,val){ localStorage.setItem(key, JSON.stringify(val)) },
};

/* sidebar definition: [icon, label, registerKey] */
const SIDEBAR = [
  ['📈','Dashboard',null],['📊','Summary',null],['🏦','Bank and Cash Accounts','bankCash'],['🧾','Receipts','receipts'],
  ['💳','Payments','payments'],['🔁','Inter Account Transfers','iat'],['☑️','Bank Reconciliations','bankRec'],
  ['🧳','Expense Claims','expenseClaims'],
  ['👤','Customers','customers'],['🗒️','Sales Quotes','salesQuotes'],['📑','Sales Orders','salesOrders'],
  ['🧾','Sales Invoices','salesInv'],['📄','Credit Notes','creditNotes'],['🚛','Delivery Notes','deliveryNotes'],
  ['🚚','Suppliers','suppliers'],
  ['🗒️','Purchase Quotes','purchQuotes'],['📑','Purchase Orders','purchOrders'],['🧾','Purchase Invoices','purchInv'],
  ['📄','Debit Notes','debitNotes'],['📦','Goods Receipts','goodsRec'],['🏷️','Inventory Items','inventory'],
  ['🔀','Inventory Transfers','invTransfers'],['🗑️','Inventory Write-offs','invWriteOffs'],
  ['🏭','Production Orders','production'],['🧷','Non-inventory Items','nonInvItems'],
  ['🧑','Employees','employees'],['💵','Payslips','payslips'],
  ['💼','Payroll','payroll'],
  ['🏗️','Fixed Assets','fixedAssets'],
  ['📉','Depreciation Entries','depreciation'],
  ['💡','Intangible Assets','intangibles'],['📐','Amortization Entries','amortization'],
  ['🏛️','Capital Accounts','capital'],['⭐','Special Accounts','special'],
  ['💹','Investments','investments'],
  ['📚','Journal Entries','journal'],
];
const SIDEBAR_FOOT = [['📈','Reports'],['⚙️','Settings']];
/* Presentation only: how the sidebar groups the sections above. Labels here are
   the same routing keys as SIDEBAR — never rename one, it is what
   selectSection(), Customize and sidebarHidden all key off. Anything not listed
   still renders, under "More", so adding a tab can't make it disappear. */
const SIDEBAR_GROUPS = [
  ['Overview',   ['Dashboard','Summary']],
  ['Banking',    ['Bank and Cash Accounts','Receipts','Payments','Inter Account Transfers',
                  'Bank Reconciliations']],
  ['Sales',      ['Customers','Sales Quotes','Sales Orders','Sales Invoices','Credit Notes',
                  'Delivery Notes']],
  ['Purchases',  ['Suppliers','Purchase Quotes','Purchase Orders','Purchase Invoices',
                  'Debit Notes','Goods Receipts','Expense Claims']],
  ['Inventory',  ['Inventory Items','Inventory Transfers','Inventory Write-offs',
                  'Production Orders','Non-inventory Items']],
  ['Payroll',    ['Employees','Payslips','Payroll']],
  ['Assets',     ['Fixed Assets','Depreciation Entries','Intangible Assets',
                  'Amortization Entries','Investments']],
  ['Accounting', ['Capital Accounts','Special Accounts','Journal Entries']],
];
/* Retired tabs: Billable Time and Withholding Tax Receipts are no longer
   modules (no sidebar entry, route, creation UI, permission row, theme or
   report link). Their stored records are NEVER deleted: the ledger engine
   keeps posting them, so customer balances, statements, ledgers and reports
   are unchanged, and a ledger row of an old record opens a read-only view
   (App.retiredView). The REG entries below stay for that view. */
const RETIRED_SECTIONS = { billableTime:'Billable Time', whtReceipts:'Withholding Tax Receipts' };
const LABEL2KEY = {}; SIDEBAR.forEach(([i,l,k])=>{ if(k) LABEL2KEY[l]=k; });
const KEY2LABEL = {}; Object.keys(LABEL2KEY).forEach(l=>{ if(!KEY2LABEL[LABEL2KEY[l]]) KEY2LABEL[LABEL2KEY[l]]=l; });

/* ===================== register configs =====================
   col kinds: text | date | money | ref ; col opts: r(right), color('blue'), bold, calc(fn)
   form types: text | date | money | number | select(options) | ref(from) | textarea           */
const CUR=['AED','USD','EUR','GBP','SAR','PKR','INR'];
const INV_OPTS_FORM=[
  {key:'colLineNum',label:'Column — Line number',type:'check'},{key:'showDescCol',label:'Column — Description',type:'check'},{key:'colDiscount',label:'Column — Discount',type:'check'},
  {key:'taxInclusive',label:'Amounts are tax inclusive',type:'check'},{key:'rounding',label:'Rounding',type:'check'},
  {key:'earlyPay',label:'Early payment discount',type:'check'},{key:'lateFees',label:'Late payment fees',type:'check'},
  {key:'totalBase',label:'Total amount in base currency',type:'check'},
  {key:'customTitleOn',label:'Custom title',type:'check'},{key:'customTitle',label:'Custom title text',type:'text'},
  {key:'customThemeOn',label:'Custom theme',type:'check'},
  {key:'hideDueDate',label:'Hide — Due date',type:'check'},{key:'hideBalanceDue',label:'Hide — Balance due',type:'check'},
  {key:'showItemImages',label:'Show item images',type:'check'},{key:'showTaxCol',label:'Show tax amount column',type:'check'},
  {key:'printStatus',label:'Print paid / unpaid status tag',type:'check'},{key:'amountInWords',label:'Amount in words',type:'check'},
  {key:'alsoDelivery',label:'Also acts as delivery note',type:'check'},{key:'footers',label:'Footers',type:'check'},
  {key:'bankDetails',label:'Bank Account Details',type:'textarea'},{key:'disclaimer',label:'Disclaimer',type:'textarea'}];
const INV_FORM_SALES=[{key:'issueDate',label:'Issue date',type:'date',req:1},{key:'dueType',label:'Due date type',type:'select',options:['Net','By']},
  {key:'dueDays',label:'Due in days',type:'number'},{key:'dueDateManual',label:'Due date',type:'date'},
  {key:'reference',label:'Reference',type:'text'},{key:'customer',label:'Customer',type:'ref',from:'customers'},
  {key:'billingAddress',label:'Billing address',type:'textarea'},{key:'description',label:'Description',type:'text'}].concat(INV_OPTS_FORM);
const INV_FORM_PURCH=[{key:'issueDate',label:'Issue date',type:'date',req:1},{key:'dueType',label:'Due date type',type:'select',options:['Net','By']},
  {key:'dueDays',label:'Due in days',type:'number'},{key:'dueDateManual',label:'Due date',type:'date'},
  {key:'reference',label:'Reference',type:'text'},{key:'supplier',label:'Supplier',type:'ref',from:'suppliers'},
  {key:'billingAddress',label:'Supplier address',type:'textarea'},{key:'description',label:'Description',type:'text'}].concat(INV_OPTS_FORM);
const INV_COLS=(party,amtLabel)=>[{key:'issueDate',label:'Issue date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},
  {key:party,label:party==='supplier'?'Supplier':'Customer',kind:'text'},{key:'description',label:'Description',kind:'text'},
  {key:'total',label:amtLabel||'Amount',kind:'money',r:1}];
/* Bank & Cash list figures (calculated columns). Pending = documents flagged pending / not cleared;
   uncategorized = lines with no account or posted to Suspense. Read-only: nothing here posts. */
function bankIbanOf(r){ if(!r) return ''; var v=r.iban; if(typeof v==='string'&&v.trim()) return v.trim(); return String(r.ibanNo||r.bankIBAN||'').trim(); }
function bankFigures(b,r){ var out={control:'',division:'',uncatIn:0,uncatOut:0,cleared:0,pendIn:0,pendOut:0,available:'',lastRec:'',timestamp:''}; if(!b||!r) return out;
  var R=b.records||{}, coa=b.coa||[]; var match=function(ref){ try{ return bankMatch(ref,r); }catch(e){ return ref===r.name; } };
  var ctl=r.controlAccount?coa.find(function(n){ return n.id===r.controlAccount; }):null; if(!ctl) ctl=coa.find(function(n){ return n.cashControl; }); out.control=ctl?(ctl.name||''):'Cash & cash equivalents';
  if(r.division){ var dv=(b.divisions||[]).find(function(d){ return d.id===r.division||d.name===r.division; }); out.division=dv?dv.name:String(r.division); }
  var susp=coa.find(function(n){ return n.type==='account'&&/^suspense$/i.test(n.name||''); });
  var uncat=function(doc){ var s=0; (doc.lines||[]).forEach(function(ln){ var a=ln.account||ln.accountName||ln.accounts||''; if(!a||(susp&&(a===susp.id||a===susp.name))) s+=Number(ln.amount)||0; }); return s; };
  var isPend=function(doc){ return doc.pending===true||doc.cleared===false||String(doc.status||'').toLowerCase()==='pending'; };
  (R.receipts||[]).forEach(function(d){ if(!match(d.receivedIn)) return; out.uncatIn+=uncat(d); if(isPend(d)) out.pendIn+=Number(d.amount)||0; });
  (R.payments||[]).forEach(function(d){ if(!match(d.paidFrom)) return; out.uncatOut+=uncat(d); if(isPend(d)) out.pendOut+=Number(d.amount)||0; });
  (R.iat||[]).forEach(function(d){ if(!isPend(d)) return; if(match(d.receivedIn)) out.pendIn+=Number(d.amount)||0; if(match(d.paidFrom)) out.pendOut+=Number(d.amount)||0; });
  var actual=0; try{ actual=bankActual(b,r); }catch(e){}
  out.cleared=Math.round((actual-out.pendIn+out.pendOut)*100)/100;
  var on=r.creditLimitOn===true||r.creditLimitOn==='1'||r.creditLimitOn===1; if(on) out.available=Math.round((actual+(Number(r.creditLimit)||0))*100)/100;
  (R.bankRec||[]).forEach(function(x){ if(match(x.account)||match(x.bankName)){ var d=String(x.date||x.issueDate||'').slice(0,10); if(d>out.lastRec) out.lastRec=d; } });
  var ts=''; (b.activity||[]).forEach(function(a){ if(a&&a.key==='bankCash'&&String(a.recId)===String(r.id)&&String(a.ts||'')>ts) ts=a.ts; });
  if(!ts&&Number(r.id)>1e12) try{ ts=new Date(Number(r.id)).toISOString(); }catch(e){}
  out.timestamp=ts?ts.slice(0,16).replace('T',' '):'';
  return out; }
const REG = {
  /* Bank & Cash: Manager's column set and order (FIX_SPEC 33-35). `def:1` = shown by default
     (Name, Cleared balance, Actual balance); the rest are offered in Edit columns. Form fields
     marked `noCol:1` are settings, not columns. The IBAN is stored under `iban` (string); the
     old designer keys bankIBAN / ibanNo are migrated forward by js/forms-fixes.js. */
  bankCash:{label:'Bank and Cash Accounts', singular:'Bank or Cash Account', newLabel:'New Bank or Cash Account',
    columns:[{key:'code',label:'Code',kind:'text'},
      {key:'name',label:'Name',kind:'text',def:1},
      {key:'controlAccount',label:'Control account',kind:'text',calc:r=>bankFigures(App.curBiz(),r).control},
      {key:'division',label:'Division',kind:'text',calc:r=>bankFigures(App.curBiz(),r).division},
      {key:'uncatReceipts',label:'Uncategorized Receipts',kind:'money',r:1,calc:r=>bankFigures(App.curBiz(),r).uncatIn},
      {key:'uncatPayments',label:'Uncategorized Payments',kind:'money',r:1,calc:r=>bankFigures(App.curBiz(),r).uncatOut},
      {key:'cleared',label:'Cleared balance',kind:'money',r:1,def:1,calc:r=>bankFigures(App.curBiz(),r).cleared},
      {key:'pendingDeposits',label:'Pending deposits',kind:'money',r:1,calc:r=>bankFigures(App.curBiz(),r).pendIn},
      {key:'pendingWithdrawals',label:'Pending withdrawals',kind:'money',r:1,calc:r=>bankFigures(App.curBiz(),r).pendOut},
      {key:'balance',label:'Actual balance',kind:'money',r:1,color:'blue',ledger:1,def:1,calc:r=>bankActual(App.curBiz(),r)},
      {key:'availableCredit',label:'Available credit',kind:'money',r:1,calc:r=>bankFigures(App.curBiz(),r).available},
      {key:'lastBankRec',label:'Last Bank Reconciliation',kind:'date',calc:r=>bankFigures(App.curBiz(),r).lastRec},
      {key:'timestamp',label:'Timestamp',kind:'text',calc:r=>bankFigures(App.curBiz(),r).timestamp},
      {key:'iban',label:'IBAN',kind:'text',calc:r=>bankIbanOf(r)}],
    defaultCols:['name','cleared','balance'],
    form:[{key:'name',label:'Name',type:'text',req:1,row:'nameCode'},
      {key:'code',label:'Code',type:'text',row:'nameCode',ph:'Optional',w:'140px'},
      {key:'hasIban',label:'International Bank Account Number (IBAN)',type:'check',noCol:1},
      {key:'iban',label:'IBAN',type:'text',showIf:'hasIban'},
      {key:'pending',label:'Can have pending transactions',type:'check',noCol:1},
      {key:'creditLimitOn',label:'Credit limit',type:'check',noCol:1},
      {key:'creditLimit',label:'Credit limit',type:'money',showIf:'creditLimitOn',noCol:1},
      {key:'inactive',label:'Inactive',type:'check',noCol:1}],
    totalCol:'balance', extraFoot:['Import bank statement']},

  receipts:{label:'Receipts', singular:'Receipt', newLabel:'New Receipt',
    columns:[{key:'date',label:'Date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},
      {key:'receivedIn',label:'Received in',kind:'text'},{key:'description',label:'Description',kind:'text'},
      {key:'paidBy',label:'Paid by',kind:'text'},{key:'amount',label:'Amount',kind:'money',r:1,bold:1}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'reference',label:'Reference',type:'text'},
      {key:'paidByType',label:'Type',type:'text'},{key:'paidBy',label:'Received from',type:'text'},
      {key:'receivedIn',label:'Received in — Account',type:'ref',from:'bankCash'},
      {key:'description',label:'Description',type:'text'}],
    lines:{kind:'cash'}, totalCol:'amount', extraFoot:['Find & recode','Receipt - Lines']},

  payments:{label:'Payments', singular:'Payment', newLabel:'New Payment',
    columns:[{key:'date',label:'Date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},
      {key:'paidFrom',label:'Paid from',kind:'text'},{key:'description',label:'Description',kind:'text'},
      {key:'payee',label:'Payee',kind:'text'},{key:'amount',label:'Amount',kind:'money',r:1,bold:1}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'reference',label:'Reference',type:'text'},
      {key:'payeeType',label:'Type',type:'text'},{key:'payee',label:'Paid to',type:'text'},
      {key:'paidFrom',label:'Paid from — Account',type:'ref',from:'bankCash'},
      {key:'description',label:'Description',type:'text'}],
    lines:{kind:'cash'}, totalCol:'amount', extraFoot:['Find & recode','Payment - Lines']},

  iat:{label:'Inter Account Transfers', singular:'Inter Account Transfer', newLabel:'New Inter Account Transfer',
    columns:[{key:'date',label:'Date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},
      {key:'paidFrom',label:'Paid from',kind:'text'},{key:'receivedIn',label:'Received in',kind:'text'},
      {key:'amount',label:'Amount',kind:'money',r:1,bold:1}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'reference',label:'Reference',type:'text'},
      {key:'paidFrom',label:'Paid from',type:'ref',from:'bankCash'},{key:'receivedIn',label:'Received in',type:'ref',from:'bankCash'},
      {key:'amount',label:'Amount',type:'money',req:1},{key:'description',label:'Description',type:'text'}],
    totalCol:'amount'},

  bankRec:{label:'Bank Reconciliations', singular:'Bank Reconciliation', newLabel:'New Bank Reconciliation',
    columns:[{key:'date',label:'Date',kind:'date'},{key:'account',label:'Account',kind:'text'},
      {key:'statementBalance',label:'Statement balance',kind:'money',r:1},
      {key:'bookBalance',label:'Book balance',kind:'money',r:1,calc:r=>App.bankBookBalance?App.bankBookBalance(App.curBiz(),r.account||r.bankName,r.date):0},
      {key:'difference',label:'Difference',kind:'money',r:1,calc:r=>App.bankBookBalance?Math.round(((Number(r.statementBalance)||0)-App.bankBookBalance(App.curBiz(),r.account||r.bankName,r.date))*100)/100:0},
      {key:'status',label:'Status',kind:'text',calc:r=>{ if(!App.bankBookBalance) return r.status||''; const d=(Number(r.statementBalance)||0)-App.bankBookBalance(App.curBiz(),r.account||r.bankName,r.date); return Math.abs(d)<0.005?'Reconciled':'Not reconciled'; }}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'account',label:'Account',type:'ref',from:'bankCash'},
      {key:'statementBalance',label:'Statement balance',type:'money'},{key:'status',label:'Status',type:'select',options:['Pending','Reconciled']}]},

  customers:{label:'Customers', singular:'Customer', newLabel:'New Customer',
    columns:[{key:'name',label:'Name',kind:'text'},{key:'code',label:'Code',kind:'text'},{key:'email',label:'Email',kind:'text'},
      {key:'receiptsCount',label:'Receipts',kind:'text',r:1,calc:r=>String(partyDocCounts(App.curBiz(),'cust',r.name).cash)},
      {key:'invoicesCount',label:'Sales Invoices',kind:'text',r:1,calc:r=>String(partyDocCounts(App.curBiz(),'cust',r.name).inv)},
      {key:'balance',label:'Accounts receivable',kind:'money',r:1,color:'blue',ledger:1,calc:r=>customerBalance(App.curBiz(),r.name)},
      {key:'status',label:'Status',kind:'status',calc:r=>partyStatus(customerBalance(App.curBiz(),r.name))}],
    form:[{key:'name',label:'Customer name',type:'text',req:1},{key:'code',label:'Code',type:'text'},
      {key:'address',label:'Address',type:'textarea'},
      {key:'phone',label:'Phone number',type:'text'},{key:'email',label:'Email',type:'text'},
      {key:'trn',label:'TRN number',type:'text'}],
    totalCol:'balance'},

  salesQuotes:{label:'Sales Quotes', singular:'Sales Quote', newLabel:'New Sales Quote',
    columns:INV_COLS('customer','Total'),
    form:INV_FORM_SALES, lines:{kind:'invoice'}, totalCol:'total', extraFoot:['Sales Quotes - Lines']},

  salesOrders:{label:'Sales Orders', singular:'Sales Order', newLabel:'New Sales Order',
    columns:INV_COLS('customer','Total'),
    form:INV_FORM_SALES, lines:{kind:'invoice'}, totalCol:'total', extraFoot:['Sales Orders - Lines']},

  salesInv:{label:'Sales Invoices', singular:'Sales Invoice', newLabel:'New Sales Invoice',
    columns:[{key:'issueDate',label:'Issue date',kind:'date'},
      {key:'reference',label:'Reference',kind:'text'},{key:'customer',label:'Customer',kind:'text'},
      {key:'description',label:'Description',kind:'text'},
      {key:'total',label:'Invoice Amount',kind:'money',r:1},
      {key:'costOfSales',label:'Cost of sales',kind:'money',r:1,calc:r=>App.invCostOfSales(r)},
      {key:'balanceDue',label:'Balance due',kind:'money',r:1,color:'blue'},
      {key:'status',label:'Status',kind:'status',calc:r=>App.invStatus(r)}],
    form:INV_FORM_SALES,
    lines:{kind:'invoice'}, totalCol:'balanceDue', extraFoot:['Sales Invoices - Lines']},

  creditNotes:{label:'Credit Notes', singular:'Credit Note', newLabel:'New Credit Note',
    columns:INV_COLS('customer','Credit total'),
    form:INV_FORM_SALES, lines:{kind:'invoice'}, totalCol:'total', extraFoot:['Credit Notes - Lines']},
  deliveryNotes:{label:'Delivery Notes', singular:'Delivery Note', newLabel:'New Delivery Note',
    columns:[{key:'issueDate',label:'Issue date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},{key:'customer',label:'Customer',kind:'text'},{key:'description',label:'Description',kind:'text'}],
    form:INV_FORM_SALES, lines:{kind:'invoice'}, totalCol:'total'},

  suppliers:{label:'Suppliers', singular:'Supplier', newLabel:'New Supplier',
    columns:[{key:'name',label:'Name',kind:'text'},{key:'code',label:'Code',kind:'text'},{key:'email',label:'Email',kind:'text'},
      {key:'paymentsCount',label:'Payments',kind:'text',r:1,calc:r=>String(partyDocCounts(App.curBiz(),'sup',r.name).cash)},
      {key:'invoicesCount',label:'Purchase Invoices',kind:'text',r:1,calc:r=>String(partyDocCounts(App.curBiz(),'sup',r.name).inv)},
      {key:'balance',label:'Accounts payable',kind:'money',r:1,color:'blue',ledger:1,calc:r=>supplierBalance(App.curBiz(),r.name)},
      {key:'status',label:'Status',kind:'status',calc:r=>partyStatus(supplierBalance(App.curBiz(),r.name))}],
    form:[{key:'name',label:'Supplier name',type:'text',req:1},{key:'code',label:'Code',type:'text'},
      {key:'category',label:'Category',type:'text'},
      {key:'address',label:'Address',type:'textarea'},
      {key:'phone',label:'Phone number',type:'text'},{key:'email',label:'Email',type:'text'},
      {key:'trn',label:'TRN number',type:'text'}],
    totalCol:'balance'},

  purchQuotes:{label:'Purchase Quotes', singular:'Purchase Quote', newLabel:'New Purchase Quote',
    columns:INV_COLS('supplier','Total'),
    form:INV_FORM_PURCH, lines:{kind:'invoice'}, totalCol:'total', extraFoot:['Purchase Quotes - Lines']},

  purchOrders:{label:'Purchase Orders', singular:'Purchase Order', newLabel:'New Purchase Order',
    columns:INV_COLS('supplier','Total'),
    form:INV_FORM_PURCH, lines:{kind:'invoice'}, totalCol:'total', extraFoot:['Purchase Orders - Lines']},

  purchInv:{label:'Purchase Invoices', singular:'Purchase Invoice', newLabel:'New Purchase Invoice',
    columns:[{key:'issueDate',label:'Issue date',kind:'date'},
      {key:'reference',label:'Reference',kind:'text'},{key:'supplier',label:'Supplier',kind:'text'},
      {key:'description',label:'Description',kind:'text'},
      {key:'total',label:'Invoice Amount',kind:'money',r:1},
      {key:'balanceDue',label:'Balance due',kind:'money',r:1,color:'blue'},
      {key:'status',label:'Status',kind:'status',calc:r=>App.invStatus(r)}],
    form:INV_FORM_PURCH,
    lines:{kind:'invoice'}, totalCol:'balanceDue', extraFoot:['Purchase Invoices - Lines']},

  debitNotes:{label:'Debit Notes', singular:'Debit Note', newLabel:'New Debit Note',
    columns:INV_COLS('supplier','Debit total'),
    form:INV_FORM_PURCH, lines:{kind:'invoice'}, totalCol:'total', extraFoot:['Debit Notes - Lines']},

  goodsRec:{label:'Goods Receipts', singular:'Goods Receipt', newLabel:'New Goods Receipt',
    columns:INV_COLS('supplier','Total'),
    form:INV_FORM_PURCH, lines:{kind:'invoice'}, totalCol:'total', extraFoot:['Goods Receipts - Lines']},

  inventory:{label:'Inventory Items', singular:'Inventory Item', newLabel:'New Inventory Item',
    columns:[{key:'name',label:'Item name',kind:'text'},
      {key:'valuation',label:'Valuation method',kind:'text',calc:r=>'Weighted average cost'},
      {key:'qtyHand',label:'Qty on hand',kind:'text',r:1,ledger:1,calc:r=>App.numStr(invItemStats(App.curBiz(),r).qtyOnHand)},
      {key:'avgCost',label:'Average cost',kind:'money',r:1,calc:r=>invItemStats(App.curBiz(),r).avgCost},
      {key:'totalCost',label:'Total cost',kind:'money',r:1,color:'blue',ledger:1,calc:r=>invItemStats(App.curBiz(),r).totalCost}],
    form:[{key:'code',label:'Item code',type:'text'},{key:'name',label:'Name',type:'text',req:1},
      {key:'unit',label:'Unit name',type:'text'},{key:'qty',label:'Starting quantity',type:'number'},
      {key:'openingCost',label:'Starting cost (total available)',type:'money'},{key:'purchasePrice',label:'Purchase price',type:'money'},{key:'salesPrice',label:'Sales price',type:'money'}],
    totalCol:'totalCost'},

  employees:{label:'Employees', singular:'Employee', newLabel:'New Employee',
    columns:[{key:'name',label:'Name',kind:'text'},{key:'code',label:'Code',kind:'text'},{key:'email',label:'Email',kind:'text'},
      {key:'balance',label:'Net owing',kind:'money',r:1,color:'blue',ledger:1,calc:r=>employeeBalance(App.curBiz(),r.name)}],
    form:[{key:'name',label:'Name',type:'text',req:1},{key:'code',label:'Code',type:'text'},
      {key:'email',label:'Email',type:'text'},{key:'phone',label:'Phone',type:'text'}]},

  payslips:{label:'Payslips', singular:'Payslip', newLabel:'New Payslip',
    columns:[{key:'date',label:'Date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},
      {key:'employee',label:'Employee',kind:'text'},{key:'description',label:'Description',kind:'text'},
      {key:'netPay',label:'Net pay',kind:'money',r:1,bold:1,color:'blue',calc:r=>payslipNetPay(r)}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'reference',label:'Reference',type:'text'},
      {key:'employee',label:'Employee',type:'ref',from:'employees'},{key:'description',label:'Description',type:'text'}],
    lines:{kind:'payslip'}, totalCol:'netPay', extraFoot:['Payslips - Lines']},

  /* monthly payroll runs. ownPage: js/payroll.js draws the whole tab (no designer form) */
  payroll:{label:'Payroll', singular:'Payroll run', newLabel:'Run payroll', ownPage:1,
    columns:[{key:'month',label:'Month',kind:'text'},{key:'date',label:'Date',kind:'date'},{key:'description',label:'Description',kind:'text'}],
    form:[]},

  fixedAssets:{label:'Fixed Assets', singular:'Fixed Asset', newLabel:'New Fixed Asset',
    columns:[{key:'name',label:'Name',kind:'text'},{key:'acqDate',label:'Acquisition date',kind:'date'},
      {key:'cost',label:'Acquisition cost',kind:'money',r:1,calc:r=>faCost(App.curBiz(),r)},
      {key:'accumDep',label:'Accumulated depreciation',kind:'money',r:1,calc:r=>faAccumDep(App.curBiz(),r)},
      {key:'book',label:'Book value',kind:'money',r:1,color:'blue',ledger:1,calc:r=>faBookValue(App.curBiz(),r)}],
    form:[{key:'name',label:'Name',type:'text',req:1},{key:'acqDate',label:'Acquisition date',type:'date'},
      {key:'cost',label:'Acquisition cost',type:'money'},{key:'accumDep',label:'Accumulated depreciation (opening)',type:'money'}],
    totalCol:'book'},

  depreciation:{label:'Depreciation Entries', singular:'Depreciation Entry', newLabel:'New Depreciation Entry',
    columns:[{key:'date',label:'Date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},
      {key:'description',label:'Description',kind:'text',calc:r=>r.narration||r.description||''},{key:'amount',label:'Total',kind:'money',r:1}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'reference',label:'Reference',type:'text'},
      {key:'method',label:'Depreciation method',type:'select',options:['Reducing balance','Straight-line'],onChange:'App.deprMethodChange(this.value)'},
      {key:'description',label:'Description',type:'text'}],
    lines:{kind:'depr'}, totalCol:'amount', extraFoot:['Depreciation Entries - Lines']},

  capital:{label:'Capital Accounts', singular:'Capital Account', newLabel:'New Capital Account',
    columns:[{key:'name',label:'Name',kind:'text'},{key:'balance',label:'Balance',kind:'money',r:1,color:'blue',ledger:1,calc:r=>capitalBalance(App.curBiz(),r.name)}],
    form:[{key:'name',label:'Name',type:'text',req:1},{key:'balance',label:'Starting balance',type:'money'}],
    totalCol:'balance'},

  special:{label:'Special Accounts', singular:'Special Account', newLabel:'New Special Account',
    columns:[{key:'name',label:'Name',kind:'text'},{key:'balance',label:'Balance',kind:'money',r:1,color:'blue'}],
    form:[{key:'name',label:'Name',type:'text',req:1},{key:'balance',label:'Starting balance',type:'money'}],
    totalCol:'balance'},

  /* ---------- expense claims ---------- */
  expenseClaims:{label:'Expense Claims', singular:'Expense Claim', newLabel:'New Expense Claim',
    columns:[{key:'date',label:'Date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},
      {key:'payer',label:'Payer',kind:'text'},{key:'description',label:'Description',kind:'text'},
      {key:'amount',label:'Amount',kind:'money',r:1,bold:1}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'reference',label:'Reference',type:'text'},
      {key:'payer',label:'Paid by',type:'text'},{key:'description',label:'Description',type:'text'}],
    lines:{kind:'cash'}, totalCol:'amount', extraFoot:['Expense Claims - Lines']},

  /* ---------- billable time ---------- */
  billableTime:{label:'Billable Time', singular:'Billable Time Entry', newLabel:'New Billable Time', retired:1,
    columns:[{key:'date',label:'Date',kind:'date'},{key:'employee',label:'Employee',kind:'text'},
      {key:'customer',label:'Customer',kind:'text'},{key:'description',label:'Description',kind:'text'},
      {key:'hours',label:'Hours',kind:'text',r:1},
      {key:'amount',label:'Amount',kind:'money',r:1,color:'blue',calc:r=>billableAmount(r)},
      {key:'status',label:'Status',kind:'status',calc:r=>r.status||'Uninvoiced'}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'employee',label:'Employee',type:'ref',from:'employees'},
      {key:'customer',label:'Customer',type:'ref',from:'customers'},{key:'description',label:'Description',type:'text'},
      {key:'hours',label:'Hours',type:'number'},{key:'rate',label:'Billable rate',type:'money'},
      {key:'status',label:'Status',type:'select',options:['Uninvoiced','Invoiced','Written off']}],
    totalCol:'amount'},

  /* ---------- withholding tax receipts ---------- */
  whtReceipts:{label:'Withholding Tax Receipts', singular:'Withholding Tax Receipt', newLabel:'New Withholding Tax Receipt', retired:1,
    columns:[{key:'date',label:'Date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},
      {key:'customer',label:'Customer',kind:'text'},{key:'invoice',label:'Sales invoice',kind:'text'},
      {key:'amount',label:'Amount',kind:'money',r:1,bold:1}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'reference',label:'Reference',type:'text'},
      {key:'customer',label:'Customer',type:'ref',from:'customers'},{key:'invoice',label:'Sales invoice',type:'text'},
      {key:'amount',label:'Amount withheld',type:'money',req:1},{key:'description',label:'Description',type:'text'}],
    totalCol:'amount'},

  /* ---------- inventory transfers ---------- */
  invTransfers:{label:'Inventory Transfers', singular:'Inventory Transfer', newLabel:'New Inventory Transfer',
    columns:[{key:'date',label:'Date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},
      {key:'fromLocation',label:'From location',kind:'text'},{key:'toLocation',label:'To location',kind:'text'},
      {key:'description',label:'Description',kind:'text'},
      {key:'qtyTotal',label:'Qty transferred',kind:'text',r:1,calc:r=>App.numStr(lineQtyTotal(r))}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'reference',label:'Reference',type:'text'},
      {key:'fromLocation',label:'From location',type:'ref',from:'locations'},
      {key:'toLocation',label:'To location',type:'ref',from:'locations'},
      {key:'description',label:'Description',type:'text'}],
    lines:{kind:'qty'}, extraFoot:['Inventory Transfers - Lines']},

  /* ---------- inventory write-offs ---------- */
  invWriteOffs:{label:'Inventory Write-offs', singular:'Inventory Write-off', newLabel:'New Inventory Write-off',
    columns:[{key:'date',label:'Date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},
      {key:'description',label:'Description',kind:'text'},
      {key:'amount',label:'Amount written off',kind:'money',r:1,color:'blue',calc:r=>writeOffValue(App.curBiz(),r)}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'reference',label:'Reference',type:'text'},
      {key:'account',label:'Write-off account',type:'account'},{key:'description',label:'Description',type:'text'}],
    lines:{kind:'writeoff'}, totalCol:'amount', extraFoot:['Inventory Write-offs - Lines']},

  /* ---------- production orders ---------- */
  production:{label:'Production Orders', singular:'Production Order', newLabel:'New Production Order',
    columns:[{key:'date',label:'Date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},
      {key:'item',label:'Finished item',kind:'text'},{key:'qty',label:'Qty produced',kind:'text',r:1},
      {key:'cost',label:'Production cost',kind:'money',r:1,color:'blue',calc:r=>productionCost(App.curBiz(),r)}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'reference',label:'Reference',type:'text'},
      {key:'item',label:'Finished item',type:'ref',from:'inventory'},{key:'qty',label:'Quantity produced',type:'number',req:1},
      {key:'extraCost',label:'Additional (non-inventory) cost',type:'money'},
      {key:'description',label:'Description',type:'text'}],
    lines:{kind:'qty'}, extraFoot:['Production Orders - Lines']},

  /* ---------- non-inventory items ---------- */
  nonInvItems:{label:'Non-inventory Items', singular:'Non-inventory Item', newLabel:'New Non-inventory Item',
    columns:[{key:'code',label:'Item code',kind:'text'},{key:'name',label:'Name',kind:'text'},
      {key:'unit',label:'Unit',kind:'text'},
      {key:'salesPrice',label:'Sale price',kind:'money',r:1},{key:'purchasePrice',label:'Purchase price',kind:'money',r:1}],
    form:[{key:'code',label:'Item code',type:'text'},{key:'name',label:'Name',type:'text',req:1},
      {key:'unit',label:'Unit name',type:'text'},
      {key:'salesPrice',label:'Sale price',type:'money'},{key:'salesAccount',label:'Sale account',type:'account'},
      {key:'purchasePrice',label:'Purchase price',type:'money'},{key:'purchaseAccount',label:'Purchase account',type:'account'},
      {key:'taxCode',label:'Tax code',type:'text'}]},

  /* ---------- intangible assets ---------- */
  intangibles:{label:'Intangible Assets', singular:'Intangible Asset', newLabel:'New Intangible Asset',
    columns:[{key:'name',label:'Name',kind:'text'},{key:'acqDate',label:'Acquisition date',kind:'date'},
      {key:'cost',label:'Acquisition cost',kind:'money',r:1,calc:r=>iaCost(App.curBiz(),r)},
      {key:'accumAmort',label:'Accumulated amortization',kind:'money',r:1,calc:r=>iaAccumAmort(App.curBiz(),r)},
      {key:'book',label:'Book value',kind:'money',r:1,color:'blue',ledger:1,calc:r=>iaBookValue(App.curBiz(),r)}],
    form:[{key:'name',label:'Name',type:'text',req:1},{key:'acqDate',label:'Acquisition date',type:'date'},
      {key:'cost',label:'Acquisition cost',type:'money'},{key:'accumAmort',label:'Accumulated amortization (opening)',type:'money'}],
    totalCol:'book'},

  /* ---------- amortization entries ---------- */
  amortization:{label:'Amortization Entries', singular:'Amortization Entry', newLabel:'New Amortization Entry',
    columns:[{key:'date',label:'Date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},
      {key:'description',label:'Description',kind:'text',calc:r=>r.narration||r.description||''},{key:'amount',label:'Total',kind:'money',r:1}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'reference',label:'Reference',type:'text'},
      {key:'method',label:'Amortization method',type:'select',options:['Straight-line','Reducing balance']},
      {key:'description',label:'Description',type:'text'}],
    lines:{kind:'amort'}, totalCol:'amount', extraFoot:['Amortization Entries - Lines']},

  /* ---------- investments ---------- */
  investments:{label:'Investments', singular:'Investment', newLabel:'New Investment',
    columns:[{key:'name',label:'Name',kind:'text'},{key:'symbol',label:'Code / symbol',kind:'text'},
      {key:'qty',label:'Qty on hand',kind:'text',r:1},
      {key:'cost',label:'Cost',kind:'money',r:1,calc:r=>investCost(App.curBiz(),r)},
      {key:'marketValue',label:'Market value',kind:'money',r:1,calc:r=>investMarketValue(r)},
      {key:'gain',label:'Unrealised gain (loss)',kind:'money',r:1,color:'blue',ledger:1,calc:r=>investGain(App.curBiz(),r)}],
    form:[{key:'name',label:'Name',type:'text',req:1},{key:'symbol',label:'Code / symbol',type:'text'},
      {key:'qty',label:'Quantity on hand',type:'number'},{key:'cost',label:'Cost (total)',type:'money'},
      {key:'marketPrice',label:'Market price per unit',type:'money'},
      {key:'controlAccount',label:'Control account',type:'text'}],
    totalCol:'gain'},

  journal:{label:'Journal Entries', singular:'Journal Entry', newLabel:'New Journal Entry',
    columns:[{key:'date',label:'Date',kind:'date'},{key:'reference',label:'Reference',kind:'text'},
      {key:'narration',label:'Narration',kind:'text'},{key:'debit',label:'Debit',kind:'money',r:1},{key:'credit',label:'Credit',kind:'money',r:1}],
    form:[{key:'date',label:'Date',type:'date',req:1},{key:'reference',label:'Reference',type:'text'},
      {key:'narration',label:'Narration',type:'textarea'}],
    lines:{kind:'journal'}},
};

