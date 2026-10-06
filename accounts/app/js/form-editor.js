/* ============================================================
   Form HTML Editor — standalone
   Categorised palette + per-element & form-level styling + DnD
   ============================================================ */
const PALETTE = [
  { key:'general', name:'General Information', icon:'🧾', items:[
      {f:'date',        label:'Date',          type:'date'},
      {f:'dueDate',     label:'Due date',      type:'date'},
      {f:'reference',   label:'Reference no.', type:'text'}
  ], custom:'Add custom field in General items' },
  { key:'customer', name:'Customers Information', icon:'👤', items:[
      {f:'custName',    label:'Customer Name',            type:'text'},
      {f:'custCode',    label:'Customer code',            type:'text'},
      {f:'custAddress', label:'Customer Address',         type:'textarea'},
      {f:'custTRN',     label:'Customer TRN',             type:'text'},
      {f:'custEmail',   label:'Customer Email',           type:'email'},
      {f:'custMobile',  label:'Customer mobile no.',      type:'tel'},
      {f:'custBalance', label:'Customer closing balance', type:'money'}
  ], custom:'Add custom field in customer form' },
  { key:'supplier', name:'Supplier Information', icon:'🚚', items:[
      {f:'supName',    label:'Supplier Name',                   type:'text'},
      {f:'supCode',    label:'Supplier code',                   type:'text'},
      {f:'supAddress', label:'Supplier address',                type:'textarea'},
      {f:'supTRN',     label:'Supplier TRN',                    type:'text'},
      {f:'supEmail',   label:'Supplier Email',                  type:'email'},
      {f:'supMobile',  label:'Supplier Mobile no.',             type:'tel'},
      {f:'supBalance', label:'Supplier ledger closing balance', type:'money'}
  ], custom:'Add custom field in supplier form' },
  { key:'bank', name:'Bank Information', icon:'🏦', items:[
      {f:'bankName',   label:'Bank name',        type:'text'},
      {f:'bankCode',   label:'Bank code',        type:'text'},
      {f:'bankIBAN',   label:'Bank IBAN number', type:'text'},
      {f:'bankAcctNo', label:'Bank Account no.', type:'text'}
  ], custom:'Add custom field in bank' },
  { key:'employee', name:'Employees Information', icon:'🧑‍💼', items:[
      {f:'empName',    label:'Name',                   type:'text'},
      {f:'empCode',    label:'code',                   type:'text'},
      {f:'empAddress', label:'address',                type:'textarea'},
      {f:'empBalance', label:'ledger closing balance', type:'money'}
  ], custom:'Add custom field in employee form' },
  { key:'item', name:'Item Information', icon:'📦', items:[
      {f:'itemName',        label:'Item name',          type:'text'},
      {f:'itemCode',        label:'Item code',          type:'text'},
      {f:'itemUnit',        label:'Unit name',          type:'text'},
      {f:'itemSellPrice',   label:'Selling price',      type:'money'},
      {f:'itemPurchPrice',  label:'Purchase price',     type:'money'},
      {f:'itemQty',         label:'Available quantity', type:'number'},
      {f:'itemOpeningCost', label:'Starting cost (total available)', type:'money'},
      {f:'itemClosingCost', label:'Closing cost',       type:'money'}
  ], custom:'Add custom field in item form' },
  { key:'fixedAsset', name:'Fixed Asset Information', icon:'🏗️', items:[
      {f:'faName',    label:'Name',                             type:'text'},
      {f:'faCode',    label:'Code',                             type:'text'},
      {f:'faCost',    label:'Acquisition cost',                 type:'money'},
      {f:'faDate',    label:'Acquisition date',                 type:'date'},
      {f:'faDepRate', label:'Depreciation rate',                type:'number'},
      {f:'faAccDep',  label:'Opening accumulated depreciation', type:'money'}
  ], custom:'Add custom field in fixed asset form' },
  { key:'capital', name:'Capital Account Information', icon:'🏛️', items:[
      {f:'capName',    label:'Name',             type:'text'},
      {f:'capCode',    label:'Code',             type:'text'},
      {f:'capDesc',    label:'Description',      type:'textarea'},
      {f:'capBalance', label:'Starting balance', type:'money'}
  ], custom:'Add custom field in capital account form' },
  { key:'voucher', name:'Vouchers Information', icon:'🧾', items:[
      {f:'saleInvoiceNo',     label:'Sale invoice no.',     type:'text'},
      {f:'deliveryNoteNo',    label:'Delivery note no.',    type:'text'},
      {f:'receiptNo',         label:'Receipt no.',          type:'text'},
      {f:'paymentNo',         label:'Payment no.',          type:'text'},
      {f:'saleQuoteNo',       label:'Sale quote no.',       type:'text'},
      {f:'purchaseInvoiceNo', label:'Purchase invoice no.', type:'text'},
      {f:'purchaseOrderNo',   label:'Purchase order no.',   type:'text'},
      {f:'journalNo',         label:'Journal no.',          type:'text'},
      {f:'creditNoteNo',      label:'Credit note no.',      type:'text'},
      {f:'debitNoteNo',       label:'Debit note no.',       type:'text'},
      {f:'lineItemNo',        label:'Line item no.',        type:'number'}
  ], custom:'Add custom field in voucher form' },
  { key:'lines', name:'Line items', icon:'▦', isLines:true, items:[
      {c:'accounts',     label:'Accounts'},
      {c:'items',        label:'Items'},
      {c:'description',  label:'Description'},
      {c:'qty',          label:'Qty',                num:true},
      {c:'price',        label:'Unit price',         num:true},
      {c:'amountNoTax',  label:'Amount without Tax', num:true},
      {c:'taxRate',      label:'Tax Rate',           num:true},
      {c:'taxAmount',    label:'Tax Amount',         num:true},
      {c:'totalWithTax', label:'Total with Tax',     num:true}
  ], custom:'Add custom field in Lines item' }
];
const TYPE_ICON = {date:'📅', text:'✎', email:'✉', tel:'📱', money:'＄', textarea:'¶', number:'#'};
const FONTS = {system:'system-ui, sans-serif', serif:'Georgia, serif', mono:'ui-monospace, Menlo, Consolas, monospace', manrope:'"Manrope", system-ui, sans-serif', arial:'Arial, Helvetica, sans-serif'};
const ITEM_ATTRS = [ {k:'name',l:'Name'}, {k:'code',l:'Code'}, {k:'unit',l:'Unit'}, {k:'sell',l:'Selling price'}, {k:'purch',l:'Purchase price'}, {k:'qty',l:'Available quantity'}, {k:'cost',l:'Closing / total cost'} ];
const FIELD_ITEM_ATTR = { itemName:'name', itemCode:'code', itemUnit:'unit', itemSellPrice:'sell', itemPurchPrice:'purch', itemQty:'qty', itemClosingCost:'cost' };
const LIST_SOURCES = [ {k:'item',l:'Items'}, {k:'account',l:'Accounts'}, {k:'tax',l:'Tax rates'}, {k:'customer',l:'Customers'}, {k:'supplier',l:'Suppliers'}, {k:'bank',l:'Banks'}, {k:'employee',l:'Employees'}, {k:'fixedAsset',l:'Fixed assets'}, {k:'subaccount',l:'Sub-account (control)'}, {k:'intangible',l:'Intangible assets'}, {k:'location',l:'Inventory locations'}, {k:'nonInvItem',l:'Non-inventory items'}, {k:'claimPayer',l:'Expense-claim payers'}, {k:'investment',l:'Investments'} ];
const DEFAULT_TAXES = [ {name:'Standard', rate:5}, {name:'Zero-rated', rate:0}, {name:'Exempt', rate:''} ];
const DOC_TYPES = [
  {k:'salesInv',l:'Sales Invoice'}, {k:'purchInv',l:'Purchase Invoice'},
  {k:'salesQuotes',l:'Sales Quotation'}, {k:'purchQuotes',l:'Purchase Quotation'},
  {k:'salesOrders',l:'Sales Order'}, {k:'purchOrders',l:'Purchase Order'},
  {k:'deliveryNotes',l:'Delivery Note'}, {k:'creditNotes',l:'Credit Note'}, {k:'debitNotes',l:'Debit Note'},
  {k:'receipts',l:'Receipt'}, {k:'payments',l:'Payment'}, {k:'iat',l:'Inter Account Transfer'}, {k:'journal',l:'Journal Entry'},
  {k:'goodsRec',l:'Goods Receipt'}, {k:'payslips',l:'Payslip'}, {k:'depreciation',l:'Depreciation Entry'},
  {k:'customers',l:'Customer'}, {k:'suppliers',l:'Supplier'}, {k:'employees',l:'Employee'},
  {k:'inventory',l:'Inventory Item'}, {k:'fixedAssets',l:'Fixed Asset'},
  {k:'expenseClaims',l:'Expense Claim'},
  {k:'invTransfers',l:'Inventory Transfer'}, {k:'invWriteOffs',l:'Inventory Write-off'}, {k:'production',l:'Production Order'},
  {k:'nonInvItems',l:'Non-inventory Item'}, {k:'intangibles',l:'Intangible Asset'}, {k:'amortization',l:'Amortization Entry'},
  {k:'investments',l:'Investment'}, {k:'bankRec',l:'Bank Reconciliation'}, {k:'special',l:'Special Account'},
  {k:'bankCash',l:'Bank & Cash'}, {k:'capital',l:'Capital Account'}, {k:'custom',l:'Custom form'}
];
const SALE_LINES = ['items','description','qty','price','amountNoTax','taxRate','totalWithTax'];
const CW=(v)=>({widthMode:'custom',widthVal:v,widthUnit:'%'});
const REF=(pfx,w)=>Object.assign({initials:pfx,autoNumber:true},CW(w||18));
const NAME_DD=(src,w)=>Object.assign({inputMode:'dropdown',listSource:src},CW(w||34));
const LINKED=(w)=>Object.assign({inputMode:'linked'},CW(w||16));
const DATEW=CW(16);
const INV_LINES=['items','accounts','description','qty','price','amountNoTax','taxRate','taxAmount','totalWithTax'];
const SIMPLE_AMT=['accounts',['custom',{label:'Sub-account',cellMode:'dropdown',dropSource:'subaccount',var:'subAccount',w:170,wUnit:'px'}],'description',['amountNoTax',{cellMode:'input',formula:'',label:'Amount'}]];
const BANKDET=['general','custom',{label:'Bank Accounts Detail',inputType:'textarea',var:'bank_accounts_detail',height:100,widthMode:'custom',widthVal:60,widthUnit:'%'}];
const WORDS=(src)=>['general','custom',{label:'Amount in words',var:'amounts_in_word',inputMode:'amountwords',wordsSrc:(src||'tot:totalWithTax'),widthMode:'full'}];
const BAL=()=>['general','custom',{label:'Balance check (Dr vs Cr)',var:'journal_balance',inputMode:'balance',balDebit:'amountNoTax',balCredit:'totalWithTax',widthMode:'custom',widthVal:62,widthUnit:'%'}];
const STARTERS = {
  salesInv:    { title:'Sales Invoice',     fields:[['general','date',DATEW],['general','reference',REF('SINV')],['customer','custName',NAME_DD('customer')],['customer','custTRN',LINKED()],['customer','custAddress',LINKED(30)]], lines:INV_LINES, tail:[BANKDET, WORDS()] },
  purchInv:    { title:'Purchase Invoice',  fields:[['general','date',DATEW],['general','reference',REF('PINV')],['supplier','supName',NAME_DD('supplier')],['supplier','supTRN',LINKED()],['supplier','supAddress',LINKED(30)]], lines:INV_LINES, tail:[BANKDET, WORDS()] },
  salesQuotes: { title:'Sales Quotation',   fields:[['general','date',DATEW],['general','reference',REF('SQT')],['customer','custName',NAME_DD('customer')],['customer','custAddress',LINKED(30)]], lines:INV_LINES, tail:[WORDS()] },
  purchQuotes: { title:'Purchase Quotation',fields:[['general','date',DATEW],['general','reference',REF('PQT')],['supplier','supName',NAME_DD('supplier')],['supplier','supAddress',LINKED(30)]], lines:INV_LINES, tail:[WORDS()] },
  salesOrders: { title:'Sales Order',       fields:[['general','date',DATEW],['general','reference',REF('SO')],['customer','custName',NAME_DD('customer')],['customer','custAddress',LINKED(30)]], lines:INV_LINES, tail:[WORDS()] },
  purchOrders: { title:'Purchase Order',    fields:[['general','date',DATEW],['general','reference',REF('PO')],['supplier','supName',NAME_DD('supplier')],['supplier','supAddress',LINKED(30)]], lines:INV_LINES, tail:[WORDS()] },
  deliveryNotes:{title:'Delivery Note',     fields:[['general','date',DATEW],['general','reference',REF('DN')],['customer','custName',NAME_DD('customer')],['customer','custAddress',LINKED(30)]], lines:['items','description','qty'] },
  creditNotes: { title:'Credit Note',       fields:[['general','date',DATEW],['general','reference',REF('CN')],['customer','custName',NAME_DD('customer')],['customer','custTRN',LINKED()]], lines:INV_LINES, tail:[WORDS()] },
  debitNotes:  { title:'Debit Note',        fields:[['general','date',DATEW],['general','reference',REF('DBN')],['supplier','supName',NAME_DD('supplier')],['supplier','supTRN',LINKED()]], lines:INV_LINES, tail:[WORDS()] },
  receipts:    { title:'Receipt',           fields:[['general','date',DATEW],['general','reference',REF('RCPT')],['bank','bankName',{inputMode:'dropdown',listSource:'bank',label:'Received In',widthMode:'custom',widthVal:50,widthUnit:'%'}],['customer','custName',{inputMode:'party',partyOther:true,label:'Received From',widthMode:'custom',widthVal:60,widthUnit:'%'}]], lines:SIMPLE_AMT, tail:[WORDS()] },
  payments:    { title:'Payment',           fields:[['general','date',DATEW],['general','reference',REF('PAY')],['bank','bankName',{inputMode:'dropdown',listSource:'bank',label:'Paid From',widthMode:'custom',widthVal:50,widthUnit:'%'}],['supplier','supName',{inputMode:'party',partyOther:true,label:'Paid To',widthMode:'custom',widthVal:60,widthUnit:'%'}]], lines:SIMPLE_AMT, tail:[WORDS()] },
  iat:         { title:'Inter Account Transfer', fields:[['general','date',DATEW],['general','reference',REF('TRF')],['general','custom',{var:'description',label:'Description',inputType:'text',row:2,widthMode:'custom',widthVal:60,widthUnit:'%'}],['bank','custom',{var:'paidFrom',label:'Paid From',inputMode:'dropdown',listSource:'bank',widthMode:'custom',widthVal:45,widthUnit:'%'}],['bank','custom',{var:'receivedIn',label:'Received In',inputMode:'dropdown',listSource:'bank',widthMode:'custom',widthVal:45,widthUnit:'%'}],['general','custom',{var:'amount',label:'Amount',inputType:'money',row:4,widthMode:'custom',widthVal:30,widthUnit:'%'}]], lines:null, tail:[WORDS('fld:amount')] },
  journal:     { title:'Journal Entry',     fields:[['general','date',DATEW],['general','reference',REF('JV')]], lines:['accounts',['custom',{label:'Sub-account',cellMode:'dropdown',dropSource:'subaccount',var:'subAccount',w:170,wUnit:'px'}],'description',['amountNoTax',{cellMode:'input',formula:'',label:'Debit'}],['totalWithTax',{cellMode:'input',formula:'',label:'Credit'}]], lineRows:2, tail:[BAL(), WORDS()] },
  goodsRec:    { title:'Goods Receipt',     fields:[['general','date',DATEW],['general','reference',REF('GRN')],['supplier','supName',NAME_DD('supplier')],['supplier','supAddress',LINKED(30)]], lines:['items','description','qty'] },
  payslips:    { title:'Payslip',           fields:[['general','date',DATEW],['employee','empName',NAME_DD('employee',40)],['employee','empCode',CW(20)]], lines:['description',['amountNoTax',{cellMode:'input',formula:'',label:'Amount'}]], tail:[WORDS()] },
  depreciation:{ title:'Depreciation Entry', fields:[['general','date',Object.assign({label:'As of date'},DATEW)],['general','reference',REF('DEP')],['general','custom',{var:'depMethod',label:'Depreciation method',inputType:'select',options:['Straight-line','Reducing balance'],defaultValue:'Straight-line',widthMode:'custom',widthVal:45,widthUnit:'%'}]], lines:[['custom',{label:'Fixed asset',cellMode:'dropdown',dropSource:'fixedAsset',var:'asset',w:190,wUnit:'px'}],['custom',{label:'Cost (ledger)',cellMode:'input',num:true,ro:true,var:'cost',w:120,wUnit:'px'}],['custom',{label:'Accumulated dep. (ledger)',cellMode:'input',num:true,ro:true,var:'accDep',w:150,wUnit:'px'}],['custom',{label:'Depreciation rate %',cellMode:'input',num:true,var:'depRate',w:120,wUnit:'px'}],['custom',{label:'Depreciation expense',cellMode:'input',num:true,ro:true,var:'depExpense',w:150,wUnit:'px'}],['custom',{label:'WDV',cellMode:'input',num:true,ro:true,var:'wdv',w:120,wUnit:'px'}]], tail:[WORDS('tot:depExpense')] },
  customers:   { title:'Customer',          fields:[['customer','custName'],['customer','custCode'],['customer','custTRN'],['customer','custEmail'],['customer','custMobile'],['customer','custAddress'],['customer','custBalance']], lines:null },
  suppliers:   { title:'Supplier',          fields:[['supplier','supName'],['supplier','supCode'],['supplier','supTRN'],['supplier','supEmail'],['supplier','supMobile'],['supplier','supAddress'],['supplier','supBalance']], lines:null },
  employees:   { title:'Employee',          fields:[['employee','empName'],['employee','empCode'],['employee','empAddress'],['employee','empBalance']], lines:null },
  bankCash:    { title:'Bank & Cash Account',fields:[['bank','bankName'],['bank','bankCode'],['bank','bankIBAN'],['bank','bankAcctNo']], lines:null },
  inventory:   { title:'Inventory Item',    fields:[['item','itemName'],['item','itemCode'],['item','itemUnit'],['item','itemQty'],['item','itemOpeningCost'],['item','itemSellPrice'],['item','itemPurchPrice']], lines:null },
  fixedAssets: { title:'Fixed Asset',       fields:[['fixedAsset','faName',{widthMode:'custom',widthVal:45,widthUnit:'%'}],['fixedAsset','faCode',{widthMode:'custom',widthVal:25,widthUnit:'%'}],['fixedAsset','faCost',{row:2,widthMode:'custom',widthVal:30,widthUnit:'%'}],['fixedAsset','faDate',{row:2,widthMode:'custom',widthVal:25,widthUnit:'%'}],['fixedAsset','faDepRate',{row:3,widthMode:'custom',widthVal:25,widthUnit:'%'}],['fixedAsset','faAccDep',{row:3,widthMode:'custom',widthVal:35,widthUnit:'%'}]], lines:null },
  capital:     { title:'Capital Account',    fields:[['capital','capName',{widthMode:'custom',widthVal:50,widthUnit:'%'}],['capital','capCode',{widthMode:'custom',widthVal:25,widthUnit:'%'}],['capital','capDesc',{row:2,widthMode:'custom',widthVal:60,widthUnit:'%'}],['capital','capBalance',{row:3,widthMode:'custom',widthVal:30,widthUnit:'%'}]], lines:null },
  bankRec:     { title:'Bank Reconciliation', fields:[['general','date',Object.assign({label:'Statement date'},DATEW)],['bank','bankName',{inputMode:'dropdown',listSource:'bank',label:'Bank account',widthMode:'custom',widthVal:45,widthUnit:'%'}],['general','custom',{var:'statementBalance',label:'Statement balance',inputType:'money',widthMode:'custom',widthVal:30,widthUnit:'%'}],['general','custom',{var:'status',label:'Status',inputType:'select',options:['Pending','Reconciled'],defaultValue:'Pending',widthMode:'custom',widthVal:30,widthUnit:'%'}]], lines:null },
  special:     { title:'Special Account',   fields:[['general','custom',{var:'name',label:'Name',inputType:'text',widthMode:'custom',widthVal:50,widthUnit:'%'}],['general','custom',{var:'code',label:'Code',inputType:'text',widthMode:'custom',widthVal:25,widthUnit:'%'}],['general','custom',{var:'balance',label:'Starting balance',inputType:'money',row:2,widthMode:'custom',widthVal:30,widthUnit:'%'}]], lines:null },
  expenseClaims:{title:'Expense Claim',     fields:[['general','date',DATEW],['general','reference',REF('EXP')],['general','custom',{var:'payer',label:'Paid by',inputMode:'dropdown',listSource:'claimPayer',widthMode:'custom',widthVal:40,widthUnit:'%'}],['general','custom',{var:'description',label:'Description',inputType:'text',widthMode:'custom',widthVal:60,widthUnit:'%'}]], lines:SIMPLE_AMT, tail:[WORDS('tot:amountNoTax')] },
  billableTime:{title:'Billable Time',      fields:[['general','date',DATEW],['employee','empName',NAME_DD('employee',34)],['customer','custName',NAME_DD('customer',40)],['general','custom',{var:'description',label:'Description',inputType:'textarea',height:60,widthMode:'full'}],['general','custom',{var:'hours',label:'Hours',inputType:'number',row:3,widthMode:'custom',widthVal:20,widthUnit:'%'}],['general','custom',{var:'rate',label:'Billable rate',inputType:'money',row:3,widthMode:'custom',widthVal:25,widthUnit:'%'}],['general','custom',{var:'status',label:'Status',inputType:'select',options:['Uninvoiced','Invoiced','Written off'],defaultValue:'Uninvoiced',row:3,widthMode:'custom',widthVal:30,widthUnit:'%'}]], lines:null },
  whtReceipts: { title:'Withholding Tax Receipt', fields:[['general','date',DATEW],['general','reference',REF('WHT')],['customer','custName',NAME_DD('customer',40)],['general','custom',{var:'invoice',label:'Sales invoice',inputType:'text',widthMode:'custom',widthVal:30,widthUnit:'%'}],['general','custom',{var:'amount',label:'Amount withheld',inputType:'money',row:3,widthMode:'custom',widthVal:30,widthUnit:'%'}],['general','custom',{var:'description',label:'Description',inputType:'text',row:3,widthMode:'custom',widthVal:50,widthUnit:'%'}]], lines:null, tail:[WORDS('fld:amount')] },
  invTransfers:{title:'Inventory Transfer', fields:[['general','date',DATEW],['general','reference',REF('ITR')],['general','custom',{var:'fromLocation',label:'From location',inputMode:'dropdown',listSource:'location',widthMode:'custom',widthVal:35,widthUnit:'%'}],['general','custom',{var:'toLocation',label:'To location',inputMode:'dropdown',listSource:'location',widthMode:'custom',widthVal:35,widthUnit:'%'}],['general','custom',{var:'description',label:'Description',inputType:'text',row:3,widthMode:'custom',widthVal:60,widthUnit:'%'}]], lines:['items','description','qty'] },
  invWriteOffs:{title:'Inventory Write-off', fields:[['general','date',DATEW],['general','reference',REF('IWO')],['general','custom',{var:'account',label:'Write-off account',inputMode:'dropdown',listSource:'account',widthMode:'custom',widthVal:40,widthUnit:'%'}],['general','custom',{var:'description',label:'Description',inputType:'text',widthMode:'custom',widthVal:60,widthUnit:'%'}]], lines:['items','description','qty',['custom',{label:'Unit cost (ledger)',cellMode:'input',num:true,ro:true,var:'unitCost',w:140,wUnit:'px'}]] },
  production:  { title:'Production Order',  fields:[['general','date',DATEW],['general','reference',REF('PRD')],['general','custom',{var:'item',label:'Finished item',inputMode:'dropdown',listSource:'item',widthMode:'custom',widthVal:40,widthUnit:'%'}],['general','custom',{var:'qty',label:'Quantity produced',inputType:'number',widthMode:'custom',widthVal:25,widthUnit:'%'}],['general','custom',{var:'extraCost',label:'Additional (non-inventory) cost',inputType:'money',row:3,widthMode:'custom',widthVal:32,widthUnit:'%'}],['general','custom',{var:'extraAccount',label:'Additional cost account',inputMode:'dropdown',listSource:'account',row:3,widthMode:'custom',widthVal:40,widthUnit:'%'}]], lines:['items','description','qty',['custom',{label:'Unit cost (ledger)',cellMode:'input',num:true,ro:true,var:'unitCost',w:140,wUnit:'px'}]] },
  nonInvItems: { title:'Non-inventory Item', fields:[['item','itemName'],['item','itemCode'],['item','itemUnit'],['item','itemSellPrice'],['general','custom',{var:'salesAccount',label:'Sale account',inputMode:'dropdown',listSource:'account',widthMode:'custom',widthVal:40,widthUnit:'%'}],['item','itemPurchPrice'],['general','custom',{var:'purchaseAccount',label:'Purchase account',inputMode:'dropdown',listSource:'account',widthMode:'custom',widthVal:40,widthUnit:'%'}],['general','custom',{var:'taxCode',label:'Tax code',inputMode:'dropdown',listSource:'tax',widthMode:'custom',widthVal:30,widthUnit:'%'}]], lines:null },
  intangibles: { title:'Intangible Asset',  fields:[['general','custom',{var:'name',label:'Name',inputType:'text',widthMode:'custom',widthVal:45,widthUnit:'%'}],['general','custom',{var:'code',label:'Code',inputType:'text',widthMode:'custom',widthVal:25,widthUnit:'%'}],['general','custom',{var:'cost',label:'Acquisition cost',inputType:'money',row:2,widthMode:'custom',widthVal:30,widthUnit:'%'}],['general','custom',{var:'acqDate',label:'Acquisition date',inputType:'date',row:2,widthMode:'custom',widthVal:25,widthUnit:'%'}],['general','custom',{var:'amortRate',label:'Amortization rate %',inputType:'number',row:3,widthMode:'custom',widthVal:25,widthUnit:'%'}],['general','custom',{var:'accumAmort',label:'Opening accumulated amortization',inputType:'money',row:3,widthMode:'custom',widthVal:38,widthUnit:'%'}]], lines:null },
  amortization:{ title:'Amortization Entry', fields:[['general','date',Object.assign({label:'As of date'},DATEW)],['general','reference',REF('AMT')],['general','custom',{var:'depMethod',label:'Amortization method',inputType:'select',options:['Straight-line','Reducing balance'],defaultValue:'Straight-line',widthMode:'custom',widthVal:45,widthUnit:'%'}]], lines:[['custom',{label:'Intangible asset',cellMode:'dropdown',dropSource:'intangible',var:'asset',w:190,wUnit:'px'}],['custom',{label:'Cost (ledger)',cellMode:'input',num:true,ro:true,var:'cost',w:120,wUnit:'px'}],['custom',{label:'Accumulated amort. (ledger)',cellMode:'input',num:true,ro:true,var:'accDep',w:170,wUnit:'px'}],['custom',{label:'Amortization rate %',cellMode:'input',num:true,var:'depRate',w:130,wUnit:'px'}],['custom',{label:'Amortization expense',cellMode:'input',num:true,ro:true,var:'depExpense',w:160,wUnit:'px'}],['custom',{label:'Carrying amount',cellMode:'input',num:true,ro:true,var:'wdv',w:130,wUnit:'px'}]], tail:[WORDS('tot:depExpense')] },
  investments: { title:'Investment',        fields:[['general','custom',{var:'name',label:'Name',inputType:'text',widthMode:'custom',widthVal:45,widthUnit:'%'}],['general','custom',{var:'symbol',label:'Code / symbol',inputType:'text',widthMode:'custom',widthVal:22,widthUnit:'%'}],['general','custom',{var:'qty',label:'Quantity on hand',inputType:'number',row:2,widthMode:'custom',widthVal:25,widthUnit:'%'}],['general','custom',{var:'cost',label:'Cost (total)',inputType:'money',row:2,widthMode:'custom',widthVal:28,widthUnit:'%'}],['general','custom',{var:'marketPrice',label:'Market price per unit',inputType:'money',row:3,widthMode:'custom',widthVal:28,widthUnit:'%'}],['general','custom',{var:'controlAccount',label:'Control account',inputType:'text',row:3,widthMode:'custom',widthVal:35,widthUnit:'%'}]], lines:null },
  custom:      { title:'Untitled form',     fields:[], lines:null }
};
const GROUP_SOURCE = { customer:'customer', supplier:'supplier', bank:'bank', employee:'employee', item:'item' };

const App = {
  tab:'elements', view:'preview', sel:null, selCol:null, _drag:null,
  state:{
    title:'Untitled form', subtitle:'',
    style:{ widthMode:'max', width:760, heightMode:'auto', height:600, bg:'#ffffff', fontSize:14, fontColor:'#222222', fontFamily:'system', bw:1, bc:'#e4e7ec', br:14, pad:34, gap:16 },
    data:{ items:[], accounts:[], taxes:DEFAULT_TAXES.map(t=>({name:t.name,rate:t.rate})) },
    blocks:[]
  },

  init(){ this.load(); try{ this.appLists=JSON.parse(localStorage.getItem('mgr_app_lists')||'null'); }catch(e){ this.appLists=null; } const cur=this.state; Object.keys(this.docs).forEach(k=>{ this.migrateBlocks(this.docs[k]); this.normalizeRows(this.docs[k]); }); this.state=cur; this.renderDocSelect(); this.renderRail(); this.renderStage(); this.renderProps(); },
  appList(k){ return (this.appLists&&this.appLists[k])||null; },
  itemList(){ const a=this.appList('items'); return (a&&a.length)?a:(this.state.data.items||[]); },
  taxList(){ const a=this.appList('taxes'); return (a&&a.length)?a:(this.state.data.taxes||[]); },
  sourceNames(src){ if(src==='item') return this.itemNames(); if(src==='account') return this.accountNames(); if(src==='tax') return this.taxNames(); const map={customer:'customers',supplier:'suppliers',bank:'banks',employee:'employees',fixedAsset:'fixedAssets'}; const a=this.appList(map[src]); return (a&&a.length)?a.slice():[]; },
  sourceCount(src){ return this.sourceNames(src).length; },
  sourceOptionsHtml(P,src){ if(src==='item') return this.itemOptionsHtml(P); if(src==='account') return this.accountOptionsHtml(P); if(src==='tax') return this.taxOptionsHtml(P); const names=this.sourceNames(src); const lbl=(LIST_SOURCES.find(s=>s.k===src)||{}).l||'option'; if(!names.length) return P+'<option value="">— select '+this.esc(lbl.replace(/s$/,'').toLowerCase())+' —</option>\n'+P+'<!-- '+this.esc(lbl)+' come from the accounting app -->'; return P+'<option value="">— select —</option>\n'+names.map(n=>P+'<option>'+this.esc(n)+'</option>').join('\n'); },
  migrateBlocks(st){ const S=st||this.state; (S.blocks||[]).forEach(b=>{
      if(b.type==='field'){ if(b.var===undefined||b.var==='') b.var=(b.field&&b.field!=='custom')?b.field:this.slugVar(b.label||'field'); if(b.inputMode===undefined) b.inputMode='input'; if(b.formula===undefined) b.formula=''; if(b.concat===undefined) b.concat=''; if(b.options===undefined) b.options=[]; if(b.initials===undefined) b.initials=''; if(b.defaultValue===undefined) b.defaultValue=''; if(b.listSource===undefined) b.listSource=(b.inputMode==='dropdown'?(GROUP_SOURCE[b.group]||'item'):''); }
      else if(b.type==='lines'){ this.normalizeLines(b); }
    }); },
  uid(){ return 'b'+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36); },
  esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
  num(v,d){ const n=parseInt(v,10); return isNaN(n)?(d||0):n; },
  numWordsInt(n){ n=Math.floor(Math.abs(n)); if(n===0) return 'Zero'; const a=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']; const b=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']; const three=x=>{ let s=''; const h=Math.floor(x/100), r=x%100; if(h){ s+=a[h]+' Hundred'; if(r) s+=' '; } if(r){ if(r<20) s+=a[r]; else { s+=b[Math.floor(r/10)]; if(r%10) s+='-'+a[r%10]; } } return s; }; const u=['','Thousand','Million','Billion','Trillion']; let i=0,out=''; while(n>0){ const g=n%1000; if(g){ out=three(g)+(u[i]?(' '+u[i]):'')+(out?(' '+out):''); } n=Math.floor(n/1000); i++; } return out; },
  numWords(v){ if(v==null||v===''||isNaN(v)) return ''; const num=Number(v); const sign=num<0?'Minus ':''; let w=Math.floor(Math.abs(num)); let c=Math.round((Math.abs(num)-w)*100); if(c===100){ w+=1; c=0; } return sign+this.numWordsInt(w)+' and '+(c<10?'0'+c:''+c)+'/100'; },
  wordsSample(b){ return this.numWords(1234.5); },

  setTab(t){ this.tab=t; document.getElementById('tabElements').classList.toggle('on',t==='elements'); document.getElementById('tabSettings').classList.toggle('on',t==='settings');
    document.getElementById('railTitle').textContent = t==='elements'?'Form Elements':'Form Settings';
    document.getElementById('railSub').textContent = t==='elements'?'Click an item to add it to the form':'Style the whole form — changes show live';
    this.renderRail(); },
  renderRail(){
    const r=document.getElementById('rail');
    if(this.tab==='settings'){ r.innerHTML=this.settingsHtml(); return; }
    r.innerHTML = PALETTE.map((g,i)=>{
      const open=i<2?' open':'';
      const rows=g.items.map(it=>{
        if(g.isLines){ const on=this.linesColOn(it.c); return '<button class="pal" onclick="App.addLineCol(\''+it.c+'\')"><span class="gic">'+(it.num?'#':'▦')+'</span>'+this.esc(it.label)+'<span class="plus">'+(on?'✓':'+')+'</span></button>'; }
        return '<button class="pal" onclick="App.addField(\''+g.key+'\',\''+it.f+'\')"><span class="gic">'+(TYPE_ICON[it.type]||'✎')+'</span>'+this.esc(it.label)+'<span class="plus">+</span></button>';
      }).join('');
      const cust=g.custom?'<button class="pal add" onclick="App.chooseCustomType(\''+g.key+'\')">＋ '+this.esc(g.custom)+'</button>':'';
      return '<details class="cat"'+open+'><summary><span class="ic">'+g.icon+'</span>'+this.esc(g.name)+'<span class="cnt">'+g.items.length+'</span><span class="chev">▸</span></summary><div class="cat-body">'+rows+cust+'</div></details>';
    }).join('');
  },

  swatchDark(prop,val,allowClear){ const v=val||'#000000'; return '<span class="swatch"><input type="color" value="'+v+'" oninput="App.setStyle(\''+prop+'\',this.value)">'+(allowClear?'<span class="clr" onclick="App.setStyle(\''+prop+'\',\'\')">reset</span>':'')+'</span>'; },
  settingsHtml(){
    const s=this.state.style;
    const sizeBtns=(prop,modes)=>'<div class="seg2">'+modes.map(m=>'<button class="'+(s[prop]===m[0]?'on':'')+'" onclick="App.setStyle(\''+prop+'\',\''+m[0]+'\')">'+m[1]+'</button>').join('')+'</div>';
    const unit=(prop,val,u)=>'<span class="unit"><input type="number" value="'+(val||0)+'" oninput="App.setStyle(\''+prop+'\',this.value)"><select disabled><option>'+(u||'px')+'</option></select></span>';
    return '<div class="sdark" style="padding:4px 4px 20px">'+
      '<div class="pgrp"><div class="pgrp-t">Form name</div>'+
        '<div class="pfield"><input type="text" value="'+this.esc(this.state.title)+'" oninput="App.setTitle(\'title\',this.value)"></div>'+
        '<div class="pfield"><label>Subtitle</label><input type="text" value="'+this.esc(this.state.subtitle)+'" placeholder="optional" oninput="App.setTitle(\'subtitle\',this.value)"></div></div>'+
      '<div class="pgrp"><div class="pgrp-t">Width</div>'+sizeBtns('widthMode',[['fixed','Fixed'],['min','Min'],['max','Max']])+
        '<div class="prow" style="margin-top:9px"><span class="plab">Value</span>'+unit('width',s.width,'px')+'</div></div>'+
      '<div class="pgrp"><div class="pgrp-t">Height</div>'+sizeBtns('heightMode',[['auto','Auto'],['fixed','Fixed'],['min','Min'],['max','Max']])+
        '<div class="prow" style="margin-top:9px"><span class="plab">Value</span>'+unit('height',s.height,'px')+'</div></div>'+
      '<div class="pgrp"><div class="pgrp-t">Colours</div>'+
        '<div class="prow"><span class="plab">Background</span>'+this.swatchDark('bg',s.bg)+'</div>'+
        '<div class="prow"><span class="plab">Font colour</span>'+this.swatchDark('fontColor',s.fontColor)+'</div></div>'+
      '<div class="pgrp"><div class="pgrp-t">Typography</div>'+
        '<div class="prow"><span class="plab">Font size</span>'+unit('fontSize',s.fontSize,'px')+'</div>'+
        '<div class="pfield"><label>Font family</label><select onchange="App.setStyle(\'fontFamily\',this.value)">'+Object.keys(FONTS).map(k=>'<option value="'+k+'"'+(s.fontFamily===k?' selected':'')+'>'+k+'</option>').join('')+'</select></div></div>'+
      '<div class="pgrp"><div class="pgrp-t">Borders</div>'+
        '<div class="prow"><span class="plab">Width</span><input class="mini-num" type="number" value="'+s.bw+'" oninput="App.setStyle(\'bw\',this.value)"><span class="plab" style="min-width:0">Radius</span><input class="mini-num" type="number" value="'+s.br+'" oninput="App.setStyle(\'br\',this.value)"></div>'+
        '<div class="prow"><span class="plab">Colour</span>'+this.swatchDark('bc',s.bc)+'</div></div>'+
      '<div class="pgrp"><div class="pgrp-t">Spacing</div>'+
        '<div class="prow"><span class="plab">Padding</span><input class="mini-num" type="number" value="'+s.pad+'" oninput="App.setStyle(\'pad\',this.value)"><span class="plab" style="min-width:0">Gap</span><input class="mini-num" type="number" value="'+s.gap+'" oninput="App.setStyle(\'gap\',this.value)"></div></div>'+
      '<div class="pgrp"><div class="pgrp-t">Data lists</div>'+
        '<div class="vb-note" style="margin-bottom:8px">Define items &amp; accounts used by drop-downs. Picking an item auto-fills its details.</div>'+
        '<button class="tbtn" style="width:100%;justify-content:center;margin-bottom:8px;background:#2b3245;border-color:#3a4359;color:#eef1f6" onclick="App.manageItems()">📦 Manage items ('+(this.state.data.items.length)+')</button>'+
        '<button class="tbtn" style="width:100%;justify-content:center;margin-bottom:8px;background:#2b3245;border-color:#3a4359;color:#eef1f6" onclick="App.manageAccounts()">📒 Manage accounts ('+(this.state.data.accounts.length)+')</button>'+
        '<button class="tbtn" style="width:100%;justify-content:center;background:#2b3245;border-color:#3a4359;color:#eef1f6" onclick="App.manageTaxes()">％ Manage tax rates ('+(this.state.data.taxes.length)+')</button></div>'+
    '</div>';
  },
  setStyle(prop,val){ const numeric=['width','height','fontSize','bw','br','pad','gap']; this.state.style[prop]=numeric.indexOf(prop)>=0?this.num(val,0):val; this.save(true); this.renderStage(); },
  setTitle(prop,val){ this.state[prop]=val; this.save(true); this.renderStage(); },

  groupOf(key){ return PALETTE.find(g=>g.key===key); },
  linesBlock(){ return this.state.blocks.find(b=>b.type==='lines'); },
  linesColOn(key){ const lb=this.linesBlock(); if(!lb) return false; return this.normalizeLines(lb).some(c=>c.key===key); },
  newField(group,f,label,type){ return { id:this.uid(), type:'field', group:group, field:f, label:label, inputType:type, required:false, var:(f!=='custom'?f:''), inputMode:'input', listSource:'', defaultValue:'', formula:'', concat:'', options:[], initials:'', widthMode:'full', widthVal:50, widthUnit:'%', height:0, color:'', bg:'', bw:'', bc:'#d4dae2', br:'', pad:0, fontSize:0, weight:'', align:'', labelPos:'', placeholder:'', hint:'' }; },
  entityOf(group){ return {customer:'customer',supplier:'supplier',bank:'bank account',employee:'employee',item:'item'}[group]||''; },
  fieldVars(exceptId){ return this.state.blocks.filter(x=>x.type==='field' && x.id!==exceptId && x.var); },
  uniqueFieldVar(base,selfId){ let v=base,n=2; const taken=this.state.blocks.filter(x=>x.type==='field'&&x.id!==selfId).map(x=>x.var); while(taken.indexOf(v)>=0){ v=base+'_'+(n++); } return v; },
  sampleFieldVal(b){ if(b.field==='itemQty') return 10; if(b.inputType==='money'||b.inputType==='number') return 100; return 0; },
  insertFieldFormulaVar(id,v){ const b=this.state.blocks.find(x=>x.id===id); if(!b) return; b.formula=((b.formula||'').trim()+' '+v).trim(); this.save(true); this.renderStage(); this.renderProps(); },
  appendField(id,prop,text){ const b=this.state.blocks.find(x=>x.id===id); if(!b) return; b[prop]=((b[prop]||'')+text); this.save(true); this.renderStage(); this.renderProps(); },
  appendCol(blockId,colId,prop,text){ const b=this.state.blocks.find(x=>x.id===blockId); if(!b) return; const c=this.linesCols(b).find(x=>x.id===colId); if(!c) return; c[prop]=((c[prop]||'')+text); this.save(true); this.renderStage(); this.renderProps(); },
  /* ---- @-mention autocomplete (used by concat + formula inputs) ---- */
  catalogLabel(v){ for(let gi=0;gi<PALETTE.length;gi++){ const g=PALETTE[gi]; for(let ii=0;ii<g.items.length;ii++){ const it=g.items[ii]; if((g.isLines?it.c:it.f)===v) return it.label; } } return null; },
  mentionVars(ctx){ let selfVar=null; if(ctx.kind&&ctx.kind[0]==='c'){ const c=this.colOf(ctx.block,ctx.col); selfVar=c?c.var:null; } else if(ctx.id){ const f=this.state.blocks.find(x=>x.id===ctx.id); selfVar=f?f.var:null; }
    const seen={}, res=[]; const push=(v,l)=>{ if(!v||seen[v]||v===selfVar) return; seen[v]=1; res.push({var:v,label:l}); };
    PALETTE.forEach(g=>{ g.items.forEach(it=>{ if(g.isLines) push(it.c,it.label); else push(it.f,it.label); }); });
    this.state.blocks.forEach(b=>{ if(b.type==='field'&&b.var) push(b.var,b.label); else if(b.type==='lines'){ this.linesCols(b).forEach(c=>{ if(c.var) push(c.var,c.label); }); } });
    return res; },
  mentionApply(ctx,val){ if(ctx.kind==='bformula') this.setBlockProp(ctx.id,'formula',val); else if(ctx.kind==='bconcat') this.setBlockProp(ctx.id,'concat',val); else if(ctx.kind==='cformula') this.lineColSet(ctx.block,ctx.col,'formula',val); else if(ctx.kind==='cconcat') this.lineColSet(ctx.block,ctx.col,'concat',val); },
  mentionInput(el,kind,a,b){ const ctx=(kind[0]==='c')?{kind:kind,block:a,col:b}:{kind:kind,id:a}; this.mentionApply(ctx,el.value); this.mentionScan(el,ctx); },
  mentionScan(el,ctx){ const val=el.value; const caret=(el.selectionStart!=null)?el.selectionStart:val.length; const left=val.slice(0,caret); const m=left.match(/@([A-Za-z0-9_]*)$/); if(!m){ this.mentionHide(); return; } const partial=m[1].toLowerCase(); const start=caret-m[0].length; const list=this.mentionVars(ctx).filter(v=>v.var.toLowerCase().indexOf(partial)>=0||(v.label||'').toLowerCase().indexOf(partial)>=0).slice(0,8); if(!list.length){ this.mentionHide(); return; } this._mention={el:el,ctx:ctx,start:start,end:caret}; this.mentionShow(el,list); },
  mentionShow(el,list){ let pop=document.getElementById('mentionPop'); if(!pop){ pop=document.createElement('div'); pop.id='mentionPop'; pop.className='mention-pop'; document.body.appendChild(pop); } pop.innerHTML=list.map(v=>'<div class="mention-it" onmousedown="App.mentionPick(event,\''+v.var+'\')"><b>@'+this.esc(v.var)+'</b><span>'+this.esc(v.label||'')+'</span></div>').join(''); const r=el.getBoundingClientRect?el.getBoundingClientRect():{left:0,bottom:0,width:180}; pop.style.left=r.left+'px'; pop.style.top=(r.bottom+4)+'px'; pop.style.minWidth=Math.max(180,r.width)+'px'; pop.style.display='block'; },
  mentionHide(){ const pop=document.getElementById('mentionPop'); if(pop) pop.style.display='none'; },
  mentionBlur(){ const me=this; setTimeout(function(){ me.mentionHide(); },150); },
  mentionPick(e,varName){ if(e&&e.preventDefault) e.preventDefault(); const mm=this._mention; if(!mm) return; const el=mm.el; const val=el.value; const ins='@'+varName+' '; const nv=val.slice(0,mm.start)+ins+val.slice(mm.end); el.value=nv; const pos=mm.start+ins.length; this.mentionApply(mm.ctx,nv); this.mentionHide(); try{ el.focus(); el.setSelectionRange(pos,pos); }catch(_){} },
  newCol(key,label,num){ const c={ id:this.uid(), key:key, label:label, num:!!num, var:(key!=='custom'?key:''), cellMode:'input', dropSource:'', itemAttr:'', formula:'', concat:'', options:[], defaultValue:'', placeholder:'', w:0, wUnit:'px', h:0, fs:0, bold:false, italic:false, align:'' };
    const SPEC={ items:{cellMode:'dropdown',dropSource:'item'}, accounts:{cellMode:'dropdown',dropSource:'account'}, taxRate:{cellMode:'dropdown',dropSource:'tax',num:true}, qty:{num:true}, price:{num:true}, amountNoTax:{cellMode:'formula',num:true,formula:'@qty*@price'}, taxAmount:{cellMode:'formula',num:true,formula:'@amountNoTax*@taxRate/100'}, totalWithTax:{cellMode:'formula',num:true,formula:'@amountNoTax+@amountNoTax*@taxRate/100'} };
    if(SPEC[key]) Object.assign(c, SPEC[key]); return c; },
  slugVar(s){ return (String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'col'); },
  uniqueVar(base,cols,selfId){ let v=base,n=2; const taken=cols.filter(c=>c.id!==selfId).map(c=>c.var); while(taken.indexOf(v)>=0){ v=base+'_'+(n++); } return v; },
  sampleVal(c){ const m={qty:2,price:100,amountNoTax:200,taxRate:5,totalWithTax:210}; if(m[c.key]!=null) return m[c.key]; if(c.kind==='formula') return 0; return c.num?10:0; },
  evalFormula(expr,scope){ if(!expr) return ''; try{ const s=String(expr).replace(/@/g,'').replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, m=>{ const v=scope[m]; return (v!=null&&v!=='')?('('+Number(v)+')'):'0'; }); if(!/^[-0-9+*/().\s]*$/.test(s)) return ''; const r=Function('return ('+s+')')(); return isFinite(r)?(Math.round(r*100)/100):''; }catch(e){ return ''; } },
  concatResolve(tpl,get){ return String(tpl||'').replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (m,v)=>{ const x=get(v); return (x==null||x==='')?('@'+v):String(x); }); },
  insertFormulaVar(blockId,colId,v){ const b=this.state.blocks.find(x=>x.id===blockId); if(!b) return; const c=this.linesCols(b).find(x=>x.id===colId); if(!c) return; c.formula=((c.formula||'').trim()+' '+v).trim(); this.save(true); this.renderStage(); this.renderProps(); },
  colOf(blockId,colId){ const b=this.state.blocks.find(x=>x.id===blockId); if(!b) return null; return this.linesCols(b).find(x=>x.id===colId)||null; },
  cellTypeOfCol(c){ if(c.cellMode==='formula') return 'formula'; if(c.cellMode==='concat') return 'ddconcat'; if(c.cellMode==='item') return 'item'; if(c.cellMode==='multi') return 'multi'; if(c.cellMode==='checkbox') return 'checkbox'; if(c.cellMode==='date') return 'date'; if(c.cellMode==='dropdown') return (c.dropSource==='custom'?'ddcustom':'ddlist'); return c.num?'number':'text'; },
  setColCellType(blockId,colId,t){ const c=this.colOf(blockId,colId); if(!c) return;
    if(t==='text'){ c.cellMode='input'; c.num=false; }
    else if(t==='number'){ c.cellMode='input'; c.num=true; }
    else if(t==='date'){ c.cellMode='date'; c.num=false; }
    else if(t==='ddlist'){ c.cellMode='dropdown'; if(!c.dropSource||c.dropSource==='custom') c.dropSource=(c.key==='accounts'?'account':(c.key==='items'?'item':'item')); }
    else if(t==='ddcustom'){ c.cellMode='dropdown'; c.dropSource='custom'; if(!c.options||!c.options.length) c.options=['Option 1','Option 2']; }
    else if(t==='multi'){ c.cellMode='multi'; if(!c.options||!c.options.length) c.options=['Option 1','Option 2']; }
    else if(t==='checkbox'){ c.cellMode='checkbox'; }
    else if(t==='formula'){ c.cellMode='formula'; c.num=true; }
    else if(t==='concat'||t==='ddconcat'){ c.cellMode='concat'; }
    else if(t==='item'){ c.cellMode='item'; if(!c.itemAttr) c.itemAttr='qty'; }
    this.save(true); this.renderStage(); this.renderProps(); },
  addColOption(blockId,colId){ const c=this.colOf(blockId,colId); if(!c) return; c.options=(c.options||[]); c.options.push('Option '+(c.options.length+1)); this.save(true); this.renderStage(); this.renderProps(); },
  setColOption(blockId,colId,i,v){ const c=this.colOf(blockId,colId); if(!c||!c.options) return; c.options[i]=v; this.save(true); this.renderStage(); },
  removeColOption(blockId,colId,i){ const c=this.colOf(blockId,colId); if(!c||!c.options) return; c.options.splice(i,1); this.save(true); this.renderStage(); this.renderProps(); },
  normalizeLines(b){ if(!Array.isArray(b.columns)){ const cat=PALETTE.find(g=>g.isLines).items; const cols=[]; cat.forEach(it=>{ if(b.cols&&b.cols[it.c]) cols.push(this.newCol(it.c,it.label,it.num)); }); (b.customCols||[]).forEach(cc=>{ const c=this.newCol('custom',cc.label,!!cc.num); c.var=this.uniqueVar(this.slugVar(cc.label),cols,c.id); cols.push(c); }); b.columns=cols; delete b.cols; delete b.customCols; } b.columns.forEach(c=>{ if(c.cellMode===undefined) c.cellMode=(c.kind==='formula'?'formula':'input'); if(c.dropSource===undefined) c.dropSource=''; if(c.dropSource==='items') c.dropSource='item'; if(c.dropSource==='accounts') c.dropSource='account'; if(c.itemAttr===undefined) c.itemAttr=''; if(c.formula===undefined) c.formula=''; if(c.concat===undefined) c.concat=''; if(c.options===undefined) c.options=[]; if(c.defaultValue===undefined) c.defaultValue=''; if(c.placeholder===undefined) c.placeholder=''; }); return b.columns; },
  colWidth(c){ return c.w?('width:'+c.w+(c.wUnit||'px')+';'):''; },
  lineCombo(optsHtml, attrs, ph, cs, disabled){ const sty=cs?(' style="'+cs+'"'):''; const e=this.esc(ph||''); return '<div class="li-combo"'+sty+'><div class="li-combo-val placeholder'+(disabled?' locked':'')+'" data-combo-val>'+e+'</div><select class="li-combo-sel"'+(disabled?' disabled':'')+' data-ph="'+e+'"'+(attrs||'')+'>'+optsHtml+'</select></div>'; },
  colCellStyle(c){ let s=''; if(c.h) s+='height:'+c.h+'px;'; if(c.fs) s+='font-size:'+c.fs+'px;'; if(c.bold) s+='font-weight:700;'; if(c.italic) s+='font-style:italic;'; if(c.align) s+='text-align:'+c.align+';'; else if(c.num) s+='text-align:right;'; return s; },
  addField(groupKey,f){ const g=this.groupOf(groupKey); const it=g.items.find(x=>x.f===f); if(!it) return; const b=this.newField(groupKey,f,it.label,it.type); b.row=this.maxRowInGroup(groupKey); this.state.blocks.push(b); this.commit(b.id); },
  addCustom(groupKey){ const name=prompt('Custom field label:',''); if(!name) return; const b=this.newField(groupKey,'custom',name.trim(),'text'); b.custom=true; b.var=this.uniqueFieldVar(this.slugVar(name),b.id); b.row=this.maxRowInGroup(groupKey); this.state.blocks.push(b); this.commit(b.id); },
  openModal(html){ this.closeModal(); const ov=document.createElement('div'); ov.className='modal-ov'; ov.id='modalOv'; ov.onclick=function(e){ if(e.target===ov) App.closeModal(); }; ov.innerHTML=html; document.body.appendChild(ov); },
  closeModal(){ const ov=document.getElementById('modalOv'); if(ov) ov.remove(); },
  chooseCustomType(group){
    const types=[ {t:'text',i:'✎',l:'Text',d:'A single line of text'}, {t:'number',i:'#',l:'Number',d:'A numeric value'}, {t:'multi',i:'☑',l:'Multiple options',d:'Tick several from a list (checkboxes)'}, {t:'select',i:'▾',l:'Drop-down list',d:'Pick one from a list'}, {t:'formula',i:'ƒ',l:'Arithmetic formula',d:'Calculate from / reference other fields'} ];
    const rows=types.map(t=>'<button class="ctype" onclick="App.addCustomTyped(\''+group+'\',\''+t.t+'\')"><span class="ci">'+t.i+'</span><span><span class="ct">'+t.l+'</span><br><span class="cd">'+this.esc(t.d)+'</span></span></button>').join('');
    this.openModal('<div class="modal"><div class="modal-h">Add custom field</div><div class="modal-b">'+rows+'</div><div class="modal-f"><button class="tbtn" onclick="App.closeModal()">Cancel</button></div></div>');
  },
  addCustomTyped(group,type){ this.closeModal(); const name=prompt('Custom field label:',''); if(!name) return; let b;
    if(type==='formula'){ b=this.newField(group,'custom',name.trim(),'number'); b.inputMode='formula'; }
    else if(type==='multi'){ b=this.newField(group,'custom',name.trim(),'multi'); b.options=['Option 1','Option 2']; }
    else if(type==='select'){ b=this.newField(group,'custom',name.trim(),'select'); b.options=['Option 1','Option 2']; }
    else if(type==='number'){ b=this.newField(group,'custom',name.trim(),'number'); }
    else { b=this.newField(group,'custom',name.trim(),'text'); }
    b.custom=true; b.var=this.uniqueFieldVar(this.slugVar(name),b.id); b.row=this.maxRowInGroup(group); this.state.blocks.push(b); this.commit(b.id); },
  addFieldOption(id){ const b=this.state.blocks.find(x=>x.id===id); if(!b) return; b.options=(b.options||[]); b.options.push('Option '+(b.options.length+1)); this.save(true); this.renderStage(); this.renderProps(); },
  setFieldOption(id,i,val){ const b=this.state.blocks.find(x=>x.id===id); if(!b||!b.options) return; b.options[i]=val; this.save(true); this.renderStage(); },
  removeFieldOption(id,i){ const b=this.state.blocks.find(x=>x.id===id); if(!b||!b.options) return; b.options.splice(i,1); this.save(true); this.renderStage(); this.renderProps(); },
  /* ---- items & accounts data lists ---- */
  manageItems(){
    const its=this.state.data.items;
    const head='<tr><th>Name</th><th>Code</th><th>Unit</th><th>Sell</th><th>Purch.</th><th>Qty</th><th>Cost</th><th></th></tr>';
    const rows=its.length?its.map((it,i)=>'<tr>'+
      ['name','code','unit','sell','purch','qty','cost'].map(k=>'<td><input value="'+this.esc(it[k]==null?'':it[k])+'" oninput="App.setItemField('+i+',\''+k+'\',this.value)"></td>').join('')+
      '<td><button class="ico del" onclick="App.removeItem('+i+')">✕</button></td></tr>').join(''):'<tr><td colspan="8" style="color:#8a93a7;padding:12px">No items yet — add one below.</td></tr>';
    this.openModal('<div class="modal" style="width:760px"><div class="modal-h">📦 Items</div><div class="modal-b"><div class="vb-note" style="margin-bottom:8px">These populate Item drop-downs; selecting one fills linked fields/columns (qty, cost, prices…).</div><div style="overflow:auto"><table class="dtbl"><thead>'+head+'</thead><tbody>'+rows+'</tbody></table></div><button class="tbtn" style="margin-top:10px" onclick="App.addItem()">＋ Add item</button></div><div class="modal-f"><button class="tbtn primary" onclick="App.closeModal()">Done</button></div></div>');
  },
  addItem(){ this.state.data.items.push({name:'',code:'',unit:'',sell:'',purch:'',qty:'',cost:''}); this.save(true); this.renderStage(); this.manageItems(); },
  removeItem(i){ this.state.data.items.splice(i,1); this.save(true); this.renderStage(); this.manageItems(); },
  setItemField(i,k,v){ if(this.state.data.items[i]){ this.state.data.items[i][k]=v; this.save(true); this.renderStage(); } },
  manageAccounts(){
    const acc=this.state.data.accounts;
    const rows=acc.length?acc.map((a,i)=>'<div class="optrow"><input value="'+this.esc(a.name||'')+'" placeholder="Account name" oninput="App.setAccountField('+i+',this.value)"><button class="ico del" onclick="App.removeAccount('+i+')">✕</button></div>').join(''):'<div class="vb-note" style="padding:8px 0">No accounts yet.</div>';
    this.openModal('<div class="modal"><div class="modal-h">📒 Accounts</div><div class="modal-b"><div class="vb-note" style="margin-bottom:8px">These populate Account drop-downs in line items.</div>'+rows+'<button class="tbtn" style="width:100%;justify-content:center;margin-top:6px" onclick="App.addAccount()">＋ Add account</button></div><div class="modal-f"><button class="tbtn primary" onclick="App.closeModal()">Done</button></div></div>');
  },
  addAccount(){ this.state.data.accounts.push({name:''}); this.save(true); this.renderStage(); this.manageAccounts(); },
  removeAccount(i){ this.state.data.accounts.splice(i,1); this.save(true); this.renderStage(); this.manageAccounts(); },
  setAccountField(i,v){ if(this.state.data.accounts[i]){ this.state.data.accounts[i].name=v; this.save(true); this.renderStage(); } },
  manageTaxes(){
    const tx=this.state.data.taxes;
    const head='<tr><th>Name</th><th>Rate %</th><th></th></tr>';
    const rows=tx.length?tx.map((t,i)=>'<tr><td><input value="'+this.esc(t.name||'')+'" placeholder="e.g. Standard" oninput="App.setTaxField('+i+',\'name\',this.value)"></td><td><input type="number" value="'+this.esc(t.rate===''||t.rate==null?'':t.rate)+'" placeholder="5" oninput="App.setTaxField('+i+',\'rate\',this.value)"></td><td><button class="ico del" onclick="App.removeTax('+i+')">✕</button></td></tr>').join(''):'<tr><td colspan="3" style="color:#8a93a7;padding:12px">No tax rates yet — add one below.</td></tr>';
    this.openModal('<div class="modal"><div class="modal-h">％ Tax rates</div><div class="modal-b"><div class="vb-note" style="margin-bottom:8px">These populate “Tax rates” drop-downs. The selected value is the rate (e.g. 5), so formulas like amount × rate ÷ 100 work.</div><div style="overflow:auto"><table class="dtbl"><thead>'+head+'</thead><tbody>'+rows+'</tbody></table></div><button class="tbtn" style="margin-top:10px" onclick="App.addTax()">＋ Add tax rate</button></div><div class="modal-f"><button class="tbtn primary" onclick="App.closeModal()">Done</button></div></div>');
  },
  addTax(){ this.state.data.taxes.push({name:'',rate:''}); this.save(true); this.renderStage(); this.manageTaxes(); },
  removeTax(i){ this.state.data.taxes.splice(i,1); this.save(true); this.renderStage(); this.manageTaxes(); },
  setTaxField(i,k,v){ if(this.state.data.taxes[i]){ this.state.data.taxes[i][k]=v; this.save(true); this.renderStage(); } },
  taxNames(){ return this.taxList().map(t=>{ const r=(t.rate===''||t.rate==null)?'':t.rate; return (t.name?t.name+' ':'')+(r!==''?('('+r+'%)'):''); }).map(s=>s.trim()).filter(Boolean); },
  taxOptionsHtml(P){ const tx=this.taxList().filter(t=>t.name||t.rate!==''&&t.rate!=null); if(!tx.length) return P+'<option value="">— select tax —</option>\n'+P+'<!-- tax rates come from the accounting app -->'; return P+'<option value="">— select tax —</option>\n'+tx.map(t=>{ const r=(t.rate===''||t.rate==null)?'':t.rate; const lbl=((t.name?t.name+' ':'')+(r!==''?('('+r+'%)'):'')).trim()||(r+'%'); return P+'<option value="'+this.esc(r)+'" data-rate="'+this.esc(r)+'">'+this.esc(lbl)+'</option>'; }).join('\n'); },
  itemNames(){ return this.itemList().map(it=>it.name).filter(Boolean); },
  accountNames(){ const a=this.appList('accounts'); return (a&&a.length)?a.slice():this.state.data.accounts.map(x=>x.name).filter(Boolean); },
  itemOptionsHtml(P,withQty){ const its=this.itemList().filter(it=>it.name); if(!its.length) return P+'<option value="">— select item —</option>\n'+P+'<!-- items come from the accounting app -->'; return P+'<option value="">— select item —</option>\n'+its.map(it=>{ const q=(it.qty!==''&&it.qty!=null)?it.qty:'0'; const lbl=withQty?(this.esc(it.name)+'  —  Qty: '+this.esc(String(q))):this.esc(it.name); return P+'<option value="'+this.esc(it.name)+'" data-name="'+this.esc(it.name)+'" data-code="'+this.esc(it.code||'')+'" data-unit="'+this.esc(it.unit||'')+'" data-sell="'+this.esc(it.sell||'')+'" data-purch="'+this.esc(it.purch||'')+'" data-qty="'+this.esc(it.qty||'')+'" data-cost="'+this.esc(it.cost||'')+'">'+lbl+'</option>'; }).join('\n'); },
  accountOptionsHtml(P){ const a=this.accountNames(); if(!a.length) return P+'<option value="">— select account —</option>\n'+P+'<!-- accounts come from the accounting app -->'; return P+'<option value="">— select account —</option>\n'+a.map(n=>P+'<option>'+this.esc(n)+'</option>').join('\n'); },
  ensureLines(){ let lb=this.linesBlock(); if(!lb){ lb={id:this.uid(),type:'lines',columns:[]}; this.state.blocks.push(lb); } this.normalizeLines(lb); return lb; },
  addLineCol(key){ const lb=this.ensureLines(); const cols=this.normalizeLines(lb); const i=cols.findIndex(c=>c.key===key); if(i>=0){ const rm=cols.splice(i,1)[0]; if(this.selCol===rm.id) this.selCol=null; } else { const cat=PALETTE.find(g=>g.isLines).items.find(x=>x.c===key); cols.push(this.newCol(key,cat?cat.label:key,cat&&cat.num)); } this.commit(lb.id); },
  addLineCustomCol(){ const lb=this.ensureLines(); const name=prompt('Custom line column label:',''); if(!name) return; const cols=this.normalizeLines(lb); const c=this.newCol('custom',name.trim(),false); c.var=this.uniqueVar(this.slugVar(name),cols,c.id); cols.push(c); this.selCol=c.id; this.commit(lb.id); },
  commit(selId){ if(selId!==undefined) this.sel=selId; this.save(true); this.renderRail(); this.renderStage(); this.renderProps(); },
  removeBlock(id){ this.state.blocks=this.state.blocks.filter(b=>b.id!==id); if(this.sel===id) this.sel=null; this.commit(); },
  moveBlock(id,dir){ const a=this.state.blocks; const i=a.findIndex(b=>b.id===id); const j=i+dir; if(i<0||j<0||j>=a.length) return; const t=a[i]; a[i]=a[j]; a[j]=t; this.commit(); },
  selectBlock(id){ this.sel=id; const b=this.state.blocks.find(x=>x.id===id); if(!b||b.type!=='lines'||!this.linesCols(b).some(c=>c.id===this.selCol)) this.selCol=null; this.renderStage(); this.renderProps(); },
  selectLineCol(blockId,colId){ this.sel=blockId; this.selCol=colId; this.renderStage(); this.renderProps(); },
  lineColMove(blockId,colId,dir){ const b=this.state.blocks.find(x=>x.id===blockId); if(!b) return; const cols=this.linesCols(b); const i=cols.findIndex(c=>c.id===colId); const j=i+dir; if(i<0||j<0||j>=cols.length) return; const t=cols[i]; cols[i]=cols[j]; cols[j]=t; this.selCol=colId; this.commit(blockId); },
  lineColSet(blockId,colId,prop,val){ const b=this.state.blocks.find(x=>x.id===blockId); if(!b) return; const c=this.linesCols(b).find(x=>x.id===colId); if(!c) return; const numeric=['w','h','fs']; c[prop]=numeric.indexOf(prop)>=0?this.num(val,0):val; if(prop==='cellMode'){ if(val==='formula') c.num=true; if(val==='dropdown'&&!c.dropSource) c.dropSource=(c.key==='accounts'?'accounts':'items'); if(val==='item'&&!c.itemAttr) c.itemAttr='qty'; } this.save(true); this.renderStage(); if(prop==='label'||prop==='cellMode'||prop==='dropSource') this.renderProps(); },
  lineColRemove(blockId,colId){ const b=this.state.blocks.find(x=>x.id===blockId); if(!b) return; const cols=this.linesCols(b); const i=cols.findIndex(c=>c.id===colId); if(i>=0) cols.splice(i,1); if(this.selCol===colId) this.selCol=null; this.commit(blockId); },

  blkEl(id){ return document.querySelector('.blk[data-id="'+id+'"]'); },
  clearDropMarks(){ document.querySelectorAll('.blk').forEach(n=>n.classList.remove('drop-before','drop-after','dragging')); },
  dragStart(e,id){ this._drag=id; try{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',id); }catch(_){} const el=this.blkEl(id); if(el) el.classList.add('dragging'); },
  dragOver(e,id){ e.preventDefault(); try{ e.dataTransfer.dropEffect='move'; }catch(_){} const stage=document.getElementById('stage'); stage.querySelectorAll('.blk').forEach(n=>n.classList.remove('drop-before','drop-after')); const el=this.blkEl(id); if(!el||id===this._drag) return; const r=el.getBoundingClientRect(); const after=(e.clientY-r.top)>r.height/2; el.classList.add(after?'drop-after':'drop-before'); },
  drop(e,id){ e.preventDefault(); const src=this._drag; const el=this.blkEl(id); const after=el?el.classList.contains('drop-after'):false; this.clearDropMarks(); if(!src||src===id){ this._drag=null; return; } this.reorder(src,id,after); this._drag=null; },
  dragEnd(){ this._drag=null; this.clearDropMarks(); },
  reorder(src,target,after){ const a=this.state.blocks; const si=a.findIndex(b=>b.id===src); if(si<0) return; const item=a.splice(si,1)[0]; let ti=a.findIndex(b=>b.id===target); if(ti<0){ a.push(item); } else { if(after) ti+=1; a.splice(ti,0,item); } this.commit(); },

  setView(v){ this.view=v; document.getElementById('vbPreview').classList.toggle('on',v==='preview'); document.getElementById('vbCode').classList.toggle('on',v==='code'); this.renderStage(); },
  pageStyle(){ const s=this.state.style; let c='';
    if(s.widthMode==='fixed') c+='width:'+s.width+'px;';
    else if(s.widthMode==='min') c+='min-width:'+s.width+'px;width:100%;';
    else c+='max-width:'+s.width+'px;width:100%;';
    if(s.heightMode==='fixed') c+='height:'+s.height+'px;';
    else if(s.heightMode==='min') c+='min-height:'+s.height+'px;';
    else if(s.heightMode==='max') c+='max-height:'+s.height+'px;overflow:auto;';
    c+='background:'+s.bg+';color:'+s.fontColor+';font-size:'+s.fontSize+'px;';
    c+='border:'+s.bw+'px solid '+s.bc+';border-radius:'+s.br+'px;padding:'+s.pad+'px;';
    c+='font-family:'+(FONTS[s.fontFamily]||FONTS.system)+';';
    return c; },
  renderStage(){
    const stage=document.getElementById('stage');
    if(this.view==='code'){ stage.innerHTML='<div class="codeview"><div class="ch">&lt;/&gt; Generated form HTML</div><pre>'+this.esc(this.genHTML())+'</pre></div><div class="hint">Exportable, self-contained HTML reflecting your styles. Click <b>Update</b> to save it to the app.</div>'; return; }
    const s=this.state; const gap=s.style.gap;
    let body = s.blocks.length ? this.renderBlocksGrouped(gap) : '<div class="empty"><div class="big">▤</div><b>Your form is empty</b><br>Pick fields from the menu on the left to start building.</div>';
    stage.innerHTML='<div class="page" style="'+this.pageStyle()+'"><h2 class="formtitle">'+this.esc(s.title||'Untitled form')+'</h2>'+(s.subtitle?'<p class="formsub">'+this.esc(s.subtitle)+'</p>':'<p class="formsub" style="opacity:.7">Click any field to edit it · drag the ⠿ handle to reorder</p>')+body+'</div>';
  },
  renderBlocksGrouped(gap){
    const out=[]; const blocks=this.state.blocks; let i=0;
    while(i<blocks.length){
      const b=blocks[i];
      if(b.type==='lines'){ out.push('<div class="secttl">Line items</div>'+this.linesBlockHtml(b)); i++; continue; }
      const gname=(this.groupOf(b.group)||{}).name||'';
      const run=[]; let j=i;
      while(j<blocks.length && blocks[j].type!=='lines' && ((this.groupOf(blocks[j].group)||{}).name||'')===gname){ run.push(blocks[j]); j++; }
      out.push('<div class="secttl">'+this.esc(gname)+'</div>');
      const buckets={}, order=[];
      run.forEach(x=>{ const r=(x.row&&x.row>0)?x.row:1; if(!(r in buckets)){ buckets[r]=[]; order.push(r); } buckets[r].push(x); });
      order.sort((a,c)=>a-c);
      order.forEach(r=>{ out.push('<div class="row2" style="gap:'+gap+'px">'+buckets[r].map(x=>this.fieldBlockHtml(x)).join('')+'</div>'); });
      i=j;
    }
    return out.join('');
  },
  wmode(b){ return b.widthMode||(b.half?'half':'full'); },
  elWrapStyle(b){ const m=this.wmode(b); if(m==='full') return 'flex-basis:100%'; if(m==='half') return 'flex-basis:calc(50% - 7px)'; return 'flex-basis:'+(b.widthVal||50)+(b.widthUnit||'%')+';flex-grow:0;max-width:100%'; },
  elInputStyle(b){ let c=''; if(b.color) c+='color:'+b.color+';'; if(b.bg) c+='background:'+b.bg+';'; if(b.bw!==''&&b.bw!=null) c+='border-width:'+b.bw+'px;'; if(b.bc) c+='border-color:'+b.bc+';'; if(b.br!==''&&b.br!=null) c+='border-radius:'+b.br+'px;'; if(b.pad) c+='padding:'+b.pad+'px;'; if(b.height) c+='min-height:'+b.height+'px;'; if(b.fontSize) c+='font-size:'+b.fontSize+'px;'; if(b.weight) c+='font-weight:'+b.weight+';'; if(b.align) c+='text-align:'+b.align+';'; return c; },
  fieldBlockHtml(b){
    const sel=(b.id===this.sel)?' sel':''; const lp=b.labelPos||'top'; const istyle=this.elInputStyle(b); const ent=this.entityOf(b.group);
    let control;
    if(b.inputMode==='party'){ const cust=this.sourceNames('customer'); const first=cust.length?cust[0]:'— select customer —'; control='<div style="display:flex;gap:8px;flex-wrap:wrap"><select class="fin" disabled style="flex:0 0 140px;'+istyle+'"><option>Customer</option><option>Supplier</option><option>Other</option></select><select class="fin" disabled style="flex:1;min-width:150px;'+istyle+'"><option>'+this.esc(first)+'</option></select></div>'; }
    else if(b.inputMode==='amountwords'){ control='<input class="fin" disabled value="'+this.esc(this.wordsSample(b))+'" style="background:#eef6f1;color:#0b6b49;font-style:italic;'+istyle+'">'; }
    else if(b.inputMode==='balance'){ control='<input class="fin" disabled value="Balanced ✓  (Dr 0.00 = Cr 0.00)" style="background:#eef6f1;color:#0b6b49;font-weight:600;'+istyle+'">'; }
    else if(b.inputMode==='formula'){ const disp=this.formulaDisplay(b); control='<input class="fin" disabled value="'+this.esc(disp)+'" style="background:#eef6f1;color:#0b6b49;font-weight:600;'+istyle+'">'; }
    else if(b.inputMode==='concat'){ const disp=this.concatDisplay(b); control='<input class="fin" disabled value="'+this.esc(disp)+'" style="background:#eef6f1;color:#0b6b49;'+istyle+'">'; }
    else if(b.inputMode==='dropdown'){ const ls=b.listSource||'item'; const lbl=(LIST_SOURCES.find(s=>s.k===ls)||{}).l||'list'; let opts=this.sourceNames(ls); let first=opts.length?opts[0]:('— select '+lbl.replace(/s$/,'').toLowerCase()+' —'); if(ls==='item'&&(b.showQty!==false)&&opts.length){ const it=this.itemList().filter(x=>x.name)[0]; if(it) first=it.name+'  —  Qty: '+((it.qty!==''&&it.qty!=null)?it.qty:'0'); } control='<select class="fin" disabled style="'+istyle+'"><option>'+this.esc(first)+'</option></select>'; }
    else if(b.inputMode==='linked'){ control='<input class="fin" disabled placeholder="from selected '+this.esc(ent||'record')+'" style="background:#f4f6f9;color:#929aa6;'+istyle+'">'; }
    else if(b.inputType==='checkbox'){ control='<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#3a4253;padding-top:2px"><input type="checkbox" disabled '+(b.defaultValue?'checked':'')+' style="width:16px;height:16px;accent-color:var(--accent)"> '+this.esc(b.placeholder||'Yes')+'</label>'; }
    else {
      const isRef=(b.field==='reference' && b.initials); const dv=b.defaultValue||'';
      if(b.inputType==='textarea') control='<textarea class="fin" disabled placeholder="'+this.esc(b.placeholder||b.label)+'" style="'+istyle+'">'+this.esc(dv)+'</textarea>';
      else if(b.inputType==='select'){ const o=(b.options&&b.options.length?b.options:['Choose…']); control='<select class="fin" disabled style="'+istyle+'">'+o.map(x=>'<option'+(x===dv?' selected':'')+'>'+this.esc(x)+'</option>').join('')+'</select>'; }
      else if(b.inputType==='multi'){ const o=(b.options&&b.options.length?b.options:['Option 1','Option 2']); control='<div style="display:flex;flex-direction:column;gap:6px;padding-top:2px">'+o.map(x=>'<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#3a4253"><input type="checkbox" disabled style="width:15px;height:15px;accent-color:var(--accent)"> '+this.esc(x)+'</label>').join('')+'</div>'; }
      else { const t={money:'text',tel:'tel',email:'email',date:'date',number:'number',text:'text'}[b.inputType]||'text'; const refAuto=(b.field==='reference'&&b.autoNumber!==false); const ph=isRef?(b.defaultValue||'0001'):(b.placeholder||(b.inputType==='money'?'0.00':b.label)); const vAttr=refAuto?(' value="'+this.esc(b.defaultValue||'0001')+'"'):(dv?(' value="'+this.esc(dv)+'"'):''); const inp='<input class="fin" type="'+t+'" disabled'+vAttr+' placeholder="'+this.esc(ph)+'" style="'+(isRef?'border-top-left-radius:0;border-bottom-left-radius:0;':'')+istyle+'"'+(refAuto?' title="auto-filled, editable"':'')+'>'; control=isRef?'<div class="ifx-wrap"><span class="ipfx">'+this.esc(b.initials)+'-</span>'+inp+'</div>':inp; }
    }
    const badge = (b.inputMode&&b.inputMode!=='input')?'<span class="imode">'+(b.inputMode==='dropdown'?'▾ list':b.inputMode==='linked'?'🔗 linked':b.inputMode==='concat'?'⊕ join':b.inputMode==='party'?'⇄ party':b.inputMode==='amountwords'?'🔤 words':b.inputMode==='balance'?'⚖ balance':'ƒ =')+'</span>':(b.inputType==='checkbox'?'<span class="imode">☑ check</span>':'');
    const labelHtml = lp==='hidden' ? '' : '<span class="lbl">'+this.esc(b.label)+(b.required?'<span class="req">*</span>':'')+'</span>';
    const hint = b.hint? '<div style="font-size:11px;color:#9aa3b2;margin-top:4px">'+this.esc(b.hint)+'</div>' : '';
    const inner = lp==='left' ? '<div style="display:flex;align-items:center;gap:10px">'+(labelHtml?'<div style="min-width:120px">'+labelHtml+'</div>':'')+'<div style="flex:1">'+control+hint+'</div></div>' : labelHtml+control+hint;
    return '<div class="blk'+sel+'" data-id="'+b.id+'" draggable="true" style="'+this.elWrapStyle(b)+'" onclick="App.selectBlock(\''+b.id+'\')" ondragstart="App.dragStart(event,\''+b.id+'\')" ondragover="App.dragOver(event,\''+b.id+'\')" ondrop="App.drop(event,\''+b.id+'\')" ondragend="App.dragEnd()">'+
      '<span class="drag-h" title="Drag to reorder">⠿</span><span class="src">'+(b.custom?'custom':(this.groupOf(b.group)||{}).key||'')+'</span>'+badge+inner+
      '<span class="acts"><button class="ico" title="Up" onclick="event.stopPropagation();App.moveBlock(\''+b.id+'\',-1)">▲</button><button class="ico" title="Down" onclick="event.stopPropagation();App.moveBlock(\''+b.id+'\',1)">▼</button><button class="ico del" title="Remove" onclick="event.stopPropagation();App.removeBlock(\''+b.id+'\')">✕</button></span>'+
    '</div>';
  },
  formulaDisplay(b){ const f=(b.formula||'').trim(); if(!f) return '= reference…'; const single=this.fieldVars(b.id).find(x=>x.var===f); if(single) return '= '+single.label; const scope={}; this.fieldVars(b.id).forEach(x=>{ scope[x.var]=this.sampleFieldVal(x); }); const r=this.evalFormula(f,scope); return (r==='')?('= '+f):('= '+r); },
  concatDisplay(b){ const t=(b.concat||'').trim(); if(!t) return 'concatenation…'; const me=this; return this.concatResolve(t, function(v){ const fld=me.fieldVars(b.id).find(x=>x.var===v); if(fld){ const blk=me.state.blocks.find(x=>x.var===v&&x.type==='field'); return (blk&&(blk.inputType==='number'||blk.inputType==='money'))?me.sampleFieldVal(blk):fld.label; } return me.catalogLabel(v); }); },
  linesCols(b){ return this.normalizeLines(b); },
  linesBlockHtml(b){ const sel=(b.id===this.sel)?' sel':''; const cols=this.linesCols(b); const _n=(v)=>this.num(v,0); let secTh=''; if(b.headBg)secTh+=';background:'+b.headBg; if(b.headColor)secTh+=';color:'+b.headColor; if(b.brd)secTh+=';border-color:'+b.brd; if(b.fs)secTh+=';font-size:'+_n(b.fs)+'px'; let secTd=''; if(b.brd)secTd+=';border-color:'+b.brd; if(b.fs)secTd+=';font-size:'+_n(b.fs)+'px'; if(b.pad)secTd+=';padding:'+_n(b.pad)+'px'; let secTot=''; if(b.totBg)secTot+=';background:'+b.totBg; if(b.totColor)secTot+=';color:'+b.totColor;
    const scope={}; cols.forEach(x=>{ if(x.var) scope[x.var]=this.sampleVal(x); });
    const head=cols.length?cols.map(c=>{ const on=(c.id===this.selCol); const fx=(c.cellMode==='formula')?' <span style="font-size:10px;color:#0b8a5f;vertical-align:super">ƒ</span>':(c.cellMode==='concat')?' <span style="font-size:10px;color:#0b8a5f;vertical-align:super">⊕</span>':(c.cellMode==='dropdown')?' <span style="font-size:10px;color:#5b6573">▾</span>':(c.cellMode==='multi')?' <span style="font-size:10px;color:#5b6573">☑</span>':(c.cellMode==='checkbox')?' <span style="font-size:10px;color:#5b6573">☑</span>':(c.cellMode==='item')?' <span style="font-size:10px;color:#5b6573">↩</span>':''; return '<th onclick="event.stopPropagation();App.selectLineCol(\''+b.id+'\',\''+c.id+'\')" style="'+this.colWidth(c)+this.colCellStyle(c)+secTh+';cursor:pointer'+(on?';outline:2px solid var(--accent);outline-offset:-2px':'')+'">'+this.esc(c.label)+fx+'</th>'; }).join(''):'<th>No columns yet — add from the Line items menu</th>';
    const me=this;
    const cells=cols.length?cols.map(c=>{ let content;
      if(c.cellMode==='formula'){ const r=this.evalFormula(c.formula,scope); content='<span style="color:#0b8a5f;font-style:italic">'+(c.formula?('= '+(r===''?'?':r)):'ƒ')+'</span>'; }
      else if(c.cellMode==='concat'){ const s=this.concatResolve((c.concat||'').trim(),function(v){ const cc=cols.find(x=>x.var===v); if(!cc) return null; return cc.num?me.sampleVal(cc):cc.label; }); content='<span style="color:#0b8a5f;font-style:italic">'+((c.concat||'').trim()?this.esc(s):'⊕')+'</span>'; }
      else if(c.cellMode==='dropdown'){ let src; if(c.dropSource==='custom') src=(c.options||[]); else src=this.sourceNames(c.dropSource); const lbl=c.dropSource==='custom'?'option':((LIST_SOURCES.find(s=>s.k===c.dropSource)||{}).l||'item').replace(/s$/,'').toLowerCase(); content='<span style="color:#5b6573">'+(src.length?this.esc(src[0]):('Choose '+lbl))+' ▾</span>'; }
      else if(c.cellMode==='multi'){ content='<span style="color:#5b6573">☑ '+((c.options||[]).length||0)+' options</span>'; }
      else if(c.cellMode==='checkbox'){ content='<input type="checkbox" disabled '+(c.defaultValue?'checked':'')+' style="width:15px;height:15px;accent-color:var(--accent)">'; }
      else if(c.cellMode==='date'){ content='<span style="color:#5b6573">'+(c.defaultValue?this.esc(c.defaultValue):'yyyy-mm-dd')+'</span>'; }
      else if(c.cellMode==='item'){ const lbl=(ITEM_ATTRS.find(a=>a.k===c.itemAttr)||{}).l||'item'; content='<span style="color:#0b6b49;font-style:italic">↩ '+this.esc(lbl)+'</span>'; }
      else content=(c.defaultValue?this.esc(c.defaultValue):(c.num?'0.00':'—'));
      return '<td style="'+this.colCellStyle(c)+secTd+'">'+content+'</td>'; }).join(''):'<td>&nbsp;</td>';
    let totPrev='';
    { const nums=cols.filter(c=>c.num||c.cellMode==='formula');
      if(nums.length){ const fi=cols.findIndex(c=>c.num||c.cellMode==='formula'); const amtCol=cols.find(c=>c.key==='amountNoTax'); let tc='';
        if(fi>0) tc+='<td colspan="'+fi+'" style="text-align:right;color:#5b6573;font-weight:700">Total</td>';
        for(let k=fi;k<cols.length;k++){ const cc=cols[k];
          if(cc.key==='taxRate'&&amtCol){ const a=this.sampleVal(amtCol),rr=this.sampleVal(cc); tc+='<td style="text-align:right;font-weight:700;color:#243043">'+(Math.round(a*rr/100*100)/100)+'</td>'; }
          else if(cc.cellMode==='formula'){ const r=this.evalFormula(cc.formula,scope); tc+='<td style="text-align:right;font-weight:700;color:#243043">'+(r===''?'0':r)+'</td>'; }
          else if(cc.num){ tc+='<td style="text-align:right;font-weight:700;color:#243043">'+this.sampleVal(cc)+'</td>'; }
          else tc+='<td></td>';
        }
        totPrev='<tfoot><tr class="litot" style="background:var(--soft)'+secTot+'">'+tc+'</tr></tfoot>';
      }
    }
    const _initN=Math.max(1,(b.initRows||1)); let _canvasRows=''; for(let _i=0;_i<_initN;_i++){ _canvasRows+='<tr>'+cells+'</tr>'; } let _secWrap=''; { var _sw=this.num(b.secW,0),_swU=(b.secWUnit||'%'),_sh=this.num(b.secH,0); if(_sw)_secWrap+='width:'+_sw+_swU+';max-width:100%;'; if(_sh)_secWrap+='min-height:'+_sh+'px;'; }
    return '<div class="blk'+sel+'" data-id="'+b.id+'" draggable="true" style="flex-basis:100%" onclick="App.selectBlock(\''+b.id+'\')" ondragstart="App.dragStart(event,\''+b.id+'\')" ondragover="App.dragOver(event,\''+b.id+'\')" ondrop="App.drop(event,\''+b.id+'\')" ondragend="App.dragEnd()">'+
      '<span class="drag-h" title="Drag to reorder">⠿</span><span class="acts"><button class="ico" title="Up" onclick="event.stopPropagation();App.moveBlock(\''+b.id+'\',-1)">▲</button><button class="ico" title="Down" onclick="event.stopPropagation();App.moveBlock(\''+b.id+'\',1)">▼</button><button class="ico del" title="Remove table" onclick="event.stopPropagation();App.removeBlock(\''+b.id+'\')">✕</button></span>'+
      '<div class="litbl-wrap"'+(_secWrap?' style="'+_secWrap+'"':'')+'><table class="litbl"><thead><tr>'+head+'</tr></thead><tbody>'+_canvasRows+'</tbody>'+totPrev+'</table></div>'+
    '</div>';
  },

  swatch(id,prop,val,allowClear){ const v=val||'#222222'; return '<span class="swatch"><input type="color" value="'+v+'" oninput="App.setBlockProp(\''+id+'\',\''+prop+'\',this.value)">'+(allowClear?'<span class="clr" onclick="App.setBlockProp(\''+id+'\',\''+prop+'\',\'\')">reset</span>':'')+'</span>'; },
  lineSectionCss(b,P){ P=P||'  '; var r=''; var hb=b.headBg,hc=b.headColor,bd=b.brd,fs=this.num(b.fs,0),pad=this.num(b.pad,0),tb=b.totBg,tc=b.totColor,st=b.stripe; var sw=this.num(b.secW,0),swU=(b.secWUnit||'%'),sh=this.num(b.secH,0);
    if(sw) r+=P+'.app-form .li-wrap{width:'+sw+swU+';max-width:100%}\n';
    if(sh) r+=P+'.app-form .li-wrap{min-height:'+sh+'px}\n';
    if(hb) r+=P+'.app-form .line-items thead th{background:'+hb+'}\n';
    if(hc) r+=P+'.app-form .line-items thead th{color:'+hc+'}\n';
    if(bd) r+=P+'.app-form .line-items th,.app-form .line-items td{border-color:'+bd+'}\n'+P+'.app-form .li-wrap{border-color:'+bd+'}\n';
    if(fs) r+=P+'.app-form .line-items{font-size:'+fs+'px}\n';
    if(pad) r+=P+'.app-form .line-items th,.app-form .line-items td{padding:'+pad+'px}\n';
    if(st) r+=P+'.app-form .line-items tbody tr:nth-child(even) td{background:'+st+'}\n';
    if(tb) r+=P+'.app-form .line-items tfoot .li-tot td{background:'+tb+'}\n';
    if(tc) r+=P+'.app-form .line-items tfoot .li-tot td{color:'+tc+'}\n';
    return r; },
  renderProps(){
    const head=document.getElementById('propsHead'); const body=document.getElementById('props');
    const b=this.state.blocks.find(x=>x.id===this.sel);
    if(!b){ head.innerHTML='⚙ Properties'; body.innerHTML='<div class="prop-empty"><span class="big">⚙</span>Select a field on the canvas to set its width, height, colours, borders and more.</div>'; return; }
    if(b.type==='lines'){ head.innerHTML='▦ Line items table'; body.innerHTML=this.linesPropsHtml(b); return; }
    head.innerHTML='✎ '+this.esc(b.label);
    const id=b.id; const wmode=this.wmode(b); const ent=this.entityOf(b.group); const ct=this.cellTypeOf(b); const showDefault=(ct==='text'||ct==='number'||ct==='ddcustom') && b.field!=='reference';
    let h='<div class="pgrp"><div class="pgrp-t">Content</div>'+
      '<div class="pfield"><label>Label</label><input type="text" value="'+this.esc(b.label)+'" oninput="App.setBlockProp(\''+id+'\',\'label\',this.value)"></div>'+
      '<div class="pfield"><label>Placeholder</label><input type="text" value="'+this.esc(b.placeholder||'')+'" oninput="App.setBlockProp(\''+id+'\',\'placeholder\',this.value)"></div>'+
      '<div class="pfield"><label>Help text</label><input type="text" value="'+this.esc(b.hint||'')+'" oninput="App.setBlockProp(\''+id+'\',\'hint\',this.value)"></div>'+
      (showDefault?('<div class="pfield"><label>Default value</label>'+((ct==='text'&&b.inputType==='textarea')?('<textarea oninput="App.setBlockProp(\''+id+'\',\'defaultValue\',this.value)" placeholder="Default paragraph text" style="width:100%;min-height:72px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font:inherit;resize:vertical">'+this.esc(b.defaultValue||'')+'</textarea>'):('<input type="'+(ct==='number'?'number':'text')+'" value="'+this.esc(b.defaultValue||'')+'" placeholder="Default form text" oninput="App.setBlockProp(\''+id+'\',\'defaultValue\',this.value)">'))+'</div>'):'')+'</div>';

    const isDrop=(ct==='ddlist'||ct==='ddcustom'||ct==='ddconcat');
    const top=[['text','Text'],['number','Number'],['date','Date'],['dropdown','Drop-down'],['multi','Multiple options'],['checkbox','Check box'],['formula','Formula'],['amountwords','Amount in words'],['party','Party']];
    if(ent) top.push(['linked','Linked']);
    h+='<div class="pgrp"><div class="pgrp-t">Cell type</div>'+
      '<div class="seg2" style="flex-wrap:wrap;gap:6px">'+top.map(o=>{ const active=(o[0]==='dropdown')?isDrop:(ct===o[0]); const target=(o[0]==='dropdown')?(isDrop?ct:'ddlist'):o[0]; return '<button class="'+(active?'on':'')+'" style="flex:1 1 28%" onclick="App.setCellType(\''+id+'\',\''+target+'\')">'+o[1]+'</button>'; }).join('')+'</div>';
    if(ct==='text' && b.field!=='reference'){ const para=(b.inputType==='textarea'); h+='<div class="prow" style="margin-top:9px"><span class="plab">Style</span><div class="seg2"><button class="'+(!para?'on':'')+'" onclick="App.setBlockProp(\''+id+'\',\'inputType\',\'text\')">Single line</button><button class="'+(para?'on':'')+'" onclick="App.setBlockProp(\''+id+'\',\'inputType\',\'textarea\')">Paragraph</button></div></div>'; }
    if(isDrop){
      h+='<div class="prow" style="margin-top:9px"><span class="plab">Type</span><div class="seg2" style="flex-wrap:wrap"><button class="'+(ct==='ddlist'?'on':'')+'" onclick="App.setCellType(\''+id+'\',\'ddlist\')">Already-available</button><button class="'+(ct==='ddcustom'?'on':'')+'" onclick="App.setCellType(\''+id+'\',\'ddcustom\')">Create list</button><button class="'+(ct==='ddconcat'?'on':'')+'" onclick="App.setCellType(\''+id+'\',\'ddconcat\')">⊕ Concatenation</button></div></div>';
      if(ct==='ddlist'){
        const lsk=b.listSource||'item'; const lsl=(LIST_SOURCES.find(s=>s.k===lsk)||{}).l||'list'; const cnt=this.sourceCount(lsk); const hasData=true;
        h+='<div class="pfield"><label>Select from list</label><select onchange="App.setBlockProp(\''+id+'\',\'listSource\',this.value)">'+LIST_SOURCES.map(s=>'<option value="'+s.k+'"'+(lsk===s.k?' selected':'')+'>'+s.l+'</option>').join('')+'</select></div>'+
          '<div class="vb-note">'+(cnt>0?('Uses your '+lsl+' from the accounting app ('+cnt+').'+(lsk==='item'?' Selecting an item fills linked fields/columns.':'')):('No '+lsl.toLowerCase()+' in the accounting app yet — add them in the accounting app.'))+'</div>'+
          (lsk==='item'?'<label class="chk" style="margin-top:8px"><input type="checkbox" '+((b.showQty!==false)?'checked':'')+' onchange="App.setBlockProp(\''+id+'\',\'showQty\',this.checked)"> Show available qty in the list</label><div class="vb-note">Each option reads e.g. <b>Widget A — Qty: 200</b>, so users see stock while choosing.</div>':'');
      } else if(ct==='ddcustom'){
        h+='<div class="vb-note" style="margin:6px 0">Create the drop-down options:</div>'+(b.options||[]).map((o,i)=>'<div class="optrow"><input type="text" value="'+this.esc(o)+'" oninput="App.setFieldOption(\''+id+'\','+i+',this.value)"><button class="ico del" title="Remove" onclick="App.removeFieldOption(\''+id+'\','+i+')">✕</button></div>').join('')+'<button class="tbtn" style="width:100%;justify-content:center" onclick="App.addFieldOption(\''+id+'\')">＋ Add option</button>';
      } else {
        const others=this.mentionVars({kind:'bconcat',id:id});
        const chips=others.length?others.map(x=>'<button class="fchip" title="inserts: @'+this.esc(x.var)+'" onclick="App.appendField(\''+id+'\',\'concat\',\' @'+x.var+'\')">'+this.esc(x.label)+'</button>').join(''):'<span class="vb-note">Add more form elements to reference them.</span>';
        h+='<div class="pfield" style="margin-top:6px"><label>Concatenation template</label><input type="text" value="'+this.esc(b.concat||'')+'" placeholder="@accountList - @itemList" oninput="App.mentionInput(this,\'bconcat\',\''+id+'\')" onblur="App.mentionBlur()"></div>'+
          '<div class="vb-note" style="margin-bottom:6px">Type <b>@</b> to insert any form element; add literal text between (e.g. a dash). Click to insert:</div><div class="fchips">'+chips+'</div>'+
          '<div class="vb-note" style="margin-top:6px">Live sample: <b style="color:#0b8a5f">'+this.esc(this.concatDisplay(b))+'</b></div>';
      }
    } else if(ct==='multi'){
      h+='<div class="vb-note" style="margin:6px 0">Create the checkbox options:</div>'+(b.options||[]).map((o,i)=>'<div class="optrow"><input type="text" value="'+this.esc(o)+'" oninput="App.setFieldOption(\''+id+'\','+i+',this.value)"><button class="ico del" title="Remove" onclick="App.removeFieldOption(\''+id+'\','+i+')">✕</button></div>').join('')+'<button class="tbtn" style="width:100%;justify-content:center" onclick="App.addFieldOption(\''+id+'\')">＋ Add option</button>';
    } else if(ct==='checkbox'){
      h+='<label class="chk" style="margin-top:8px"><input type="checkbox" '+(b.defaultValue?'checked':'')+' onchange="App.setBlockProp(\''+id+'\',\'defaultValue\',this.checked?\'1\':\'\')"> Checked by default</label>';
    } else if(ct==='formula'){
      const others=this.mentionVars({kind:'bformula',id:id});
      const chips=others.length?others.map(x=>'<button class="fchip" title="inserts: @'+this.esc(x.var)+'" onclick="App.appendField(\''+id+'\',\'formula\',\' @'+x.var+'\')">'+this.esc(x.label)+'</button>').join(''):'<span class="vb-note">Add more form elements to reference them.</span>';
      const fvs=this.fieldVars(id); const single=fvs.find(x=>x.var===(b.formula||'').replace(/@/g,'').trim());
      const scope={}; fvs.forEach(x=>{ scope[x.var]=this.sampleFieldVal(x); }); const r=this.evalFormula((b.formula||'').trim(),scope);
      const sample = !((b.formula||'').trim())?'—':(single?('= '+single.label):(r===''?'reference / invalid':('= '+r)));
      h+='<div class="pfield" style="margin-top:8px"><label>Reference / formula</label><input type="text" value="'+this.esc(b.formula||'')+'" placeholder="@itemSellPrice * @itemQty" oninput="App.mentionInput(this,\'bformula\',\''+id+'\')" onblur="App.mentionBlur()"></div>'+
        '<div class="vb-note" style="margin-bottom:6px">Type <b>@</b> to pick any form element, or click one. Use + − × ÷ and ( ):</div><div class="fchips">'+chips+'</div>'+
        '<div class="vb-note" style="margin-top:6px">Live sample: <b style="color:#0b8a5f">'+this.esc(sample)+'</b></div>';
    } else if(ct==='linked'){
      h+='<div class="vb-note" style="margin-top:8px">Auto-filled from the selected '+this.esc(ent||'record')+' — read-only.'+(b.group==='item'?' Fills from the item drop-down.':'')+'</div>';
    } else if(ct==='amountwords'){
      const cur=b.wordsSrc||'tot:totalWithTax'; const srcs=[['tot:totalWithTax','Line items \u2014 Grand total (Total with Tax)'],['tot:amountNoTax','Line items \u2014 Subtotal (Amount without Tax)'],['tot:tax','Line items \u2014 Tax total']];
      this.state.blocks.forEach(x=>{ if(x.type==='field'&&x.id!==id&&x.var&&(x.inputType==='number'||x.inputType==='money'||x.inputMode==='formula')) srcs.push(['fld:'+x.var,'Field \u2014 '+x.label]); });
      h+='<div class="pfield" style="margin-top:8px"><label>Amount source (figure to spell out)</label><select onchange="App.setBlockProp(\''+id+'\',\'wordsSrc\',this.value)">'+srcs.map(o=>'<option value="'+o[0]+'"'+(cur===o[0]?' selected':'')+'>'+this.esc(o[1])+'</option>').join('')+'</select></div>'+
        '<div class="vb-note">Auto-writes the selected figure in words (read-only), updating live. Default is the line-items grand total (Total with Tax).</div>';
    } else if(ct==='party'){
      h+='<div class="vb-note" style="margin-top:8px">Shows a <b>Customer / Supplier / Other</b> selector. The matching input appears automatically: <b>Customer</b> → your customer list, <b>Supplier</b> → your supplier list, <b>Other</b> → a free-text box. Great for Payment / Receipt party selection.</div>'+
        '<label class="chk" style="margin-top:6px"><input type="checkbox" '+((b.partyOther!==false)?'checked':'')+' onchange="App.setBlockProp(\''+id+'\',\'partyOther\',this.checked)"> Allow “Other” (free text)</label>';
    }
    h+='</div>';
    if(b.field==='reference'){ const auto=(b.autoNumber!==false); h+='<div class="pgrp"><div class="pgrp-t">Reference number</div>'+
      '<div class="prow"><span class="plab">Numbering</span><div class="seg2"><button class="'+(auto?'on':'')+'" onclick="App.setBlockProp(\''+id+'\',\'autoNumber\',true)">Auto</button><button class="'+(!auto?'on':'')+'" onclick="App.setBlockProp(\''+id+'\',\'autoNumber\',false)">Type</button></div></div>'+
      '<div class="pfield"><label>Initials / prefix</label><input type="text" value="'+this.esc(b.initials||'')+'" placeholder="e.g. INV, SINV, PO" oninput="App.setBlockProp(\''+id+'\',\'initials\',this.value)"></div>'+
      '<div class="pfield"><label>'+(auto?'Starting number':'Default number')+'</label><input type="text" value="'+this.esc(b.defaultValue||'')+'" placeholder="0001" oninput="App.setBlockProp(\''+id+'\',\'defaultValue\',this.value)"></div>'+
      '<div class="vb-note">'+(auto?'Auto-filled with the next number, but the user can still edit it — ':'Left blank for the user to type — ')+'looks like <b>'+(b.initials?this.esc(b.initials)+'-':'')+this.esc(b.defaultValue||'0001')+'</b>.</div></div>'; }
    h+='<div class="pgrp"><div class="pgrp-t">Layout</div>'+
      '<div class="pfield"><label>Width</label><div class="seg2">'+
        '<button class="'+(wmode==='full'?'on':'')+'" onclick="App.setBlockProp(\''+id+'\',\'widthMode\',\'full\')">Full</button>'+
        '<button class="'+(wmode==='half'?'on':'')+'" onclick="App.setBlockProp(\''+id+'\',\'widthMode\',\'half\')">Half</button>'+
        '<button class="'+(wmode==='custom'?'on':'')+'" onclick="App.setBlockProp(\''+id+'\',\'widthMode\',\'custom\')">Custom</button></div>'+
        (wmode==='custom'?'<div class="prow" style="margin-top:8px"><span class="plab">Size</span><span class="unit"><input type="number" value="'+(b.widthVal||50)+'" oninput="App.setBlockProp(\''+id+'\',\'widthVal\',this.value)"><select onchange="App.setBlockProp(\''+id+'\',\'widthUnit\',this.value)"><option value="%"'+((b.widthUnit||'%')==='%'?' selected':'')+'>%</option><option value="px"'+(b.widthUnit==='px'?' selected':'')+'>px</option></select></span></div>':'')+'</div>'+
      '<div class="prow"><span class="plab">Label</span><div class="seg2">'+['top','left','hidden'].map(p=>'<button class="'+(((b.labelPos||'top')===p)?'on':'')+'" onclick="App.setBlockProp(\''+id+'\',\'labelPos\',\''+p+'\')" style="text-transform:capitalize">'+p+'</button>').join('')+'</div></div>'+
      '<div class="prow"><span class="plab">Align</span><div class="seg2">'+[['left','L'],['center','C'],['right','R']].map(o=>'<button class="'+((b.align===o[0]||(!b.align&&o[0]==='left'))?'on':'')+'" onclick="App.setBlockProp(\''+id+'\',\'align\',\''+o[0]+'\')">'+o[1]+'</button>').join('')+'</div></div>'+
      '<div class="prow" style="margin-top:8px"><span class="plab">Row</span><span class="unit"><button class="tbtn" title="Move up a row" style="padding:6px 11px" onclick="App.bumpRow(\''+id+'\',-1)">−</button><input type="number" min="1" value="'+(b.row||1)+'" style="width:56px;text-align:center" onchange="App.setBlockProp(\''+id+'\',\'row\',this.value)"><button class="tbtn" title="Move down a row" style="padding:6px 11px" onclick="App.bumpRow(\''+id+'\',1)">＋</button></span></div><div class="vb-note">Elements with the same <b>Row</b> number sit on one line (left → right). Give an element a higher number to push it to a lower row.</div></div>';
    h+='<div class="pgrp"><div class="pgrp-t">Box</div>'+
      '<div class="prow"><span class="plab">Height</span><input class="mini-num" type="number" value="'+(b.height||0)+'" oninput="App.setBlockProp(\''+id+'\',\'height\',this.value)"><span class="plab" style="min-width:0">Padding</span><input class="mini-num" type="number" value="'+(b.pad||0)+'" oninput="App.setBlockProp(\''+id+'\',\'pad\',this.value)"></div>'+
      '<div class="prow"><span class="plab">Border</span><input class="mini-num" type="number" value="'+(b.bw||0)+'" oninput="App.setBlockProp(\''+id+'\',\'bw\',this.value)" title="width"><span class="plab" style="min-width:0">Radius</span><input class="mini-num" type="number" value="'+(b.br||0)+'" oninput="App.setBlockProp(\''+id+'\',\'br\',this.value)"></div>'+
      '<div class="prow"><span class="plab">Border colour</span>'+this.swatch(id,'bc',b.bc,true)+'</div></div>';
    h+='<div class="pgrp"><div class="pgrp-t">Colours</div>'+
      '<div class="prow"><span class="plab">Text</span>'+this.swatch(id,'color',b.color,true)+'</div>'+
      '<div class="prow"><span class="plab">Background</span>'+this.swatch(id,'bg',b.bg,true)+'</div></div>';
    h+='<div class="pgrp"><div class="pgrp-t">Text</div>'+
      '<div class="prow"><span class="plab">Font size</span><input class="mini-num" type="number" value="'+(b.fontSize||0)+'" oninput="App.setBlockProp(\''+id+'\',\'fontSize\',this.value)" placeholder="auto"><span class="plab" style="min-width:0">px</span></div>'+
      '<div class="prow"><span class="plab">Weight</span><div class="seg2">'+[['','Normal'],['600','Medium'],['700','Bold']].map(o=>'<button class="'+(((b.weight||'')===o[0])?'on':'')+'" onclick="App.setBlockProp(\''+id+'\',\'weight\',\''+o[0]+'\')">'+o[1]+'</button>').join('')+'</div></div></div>';
    h+='<div class="pgrp"><label class="chk"><input type="checkbox" '+(b.required?'checked':'')+' onchange="App.setBlockProp(\''+id+'\',\'required\',this.checked)"> Required field</label>'+
      '<label class="chk"><input type="checkbox" '+((b.printable!==false)?'checked':'')+' onchange="App.setBlockProp(\''+id+'\',\'printable\',this.checked)"> Show in printed voucher</label>'+
      '<button class="tbtn" style="width:100%;justify-content:center;margin-top:10px;border-color:#f0c0c0;color:var(--danger)" onclick="App.removeBlock(\''+id+'\')">🗑 Remove field</button></div>';
    body.innerHTML=h;
  },
  linesPropsHtml(b){ const cols=this.linesCols(b);
    const list = cols.length ? cols.map((c,i)=>'<div class="lc-row'+(c.id===this.selCol?' on':'')+'" onclick="App.selectLineCol(\''+b.id+'\',\''+c.id+'\')">'+
        '<span class="lc-ord"><button class="vb-ob" '+(i===0?'disabled':'')+' title="Move left" onclick="event.stopPropagation();App.lineColMove(\''+b.id+'\',\''+c.id+'\',-1)">◀</button><button class="vb-ob" '+(i===cols.length-1?'disabled':'')+' title="Move right" onclick="event.stopPropagation();App.lineColMove(\''+b.id+'\',\''+c.id+'\',1)">▶</button></span>'+
        '<span class="lc-lbl">'+this.esc(c.label)+'</span>'+
        '<button class="ico del" title="Remove column" onclick="event.stopPropagation();App.lineColRemove(\''+b.id+'\',\''+c.id+'\')">✕</button></div>').join('') : '<div class="vb-note" style="padding:8px 4px">No columns yet.</div>';
    const present=cols.filter(c=>c.key!=='custom').map(c=>c.key);
    const catalog=PALETTE.find(g=>g.isLines).items.filter(it=>present.indexOf(it.c)<0);
    const addStd = catalog.length ? '<select class="addsel2" onchange="if(this.value)App.addLineCol(this.value);this.selectedIndex=0"><option value="">＋ Add standard column…</option>'+catalog.map(it=>'<option value="'+it.c+'">'+this.esc(it.label)+'</option>').join('')+'</select>' : '<div class="vb-note">All standard columns added.</div>';
    let editor='';
    const c=cols.find(x=>x.id===this.selCol);
    if(c){ const aseg=[['left','L'],['center','C'],['right','R']].map(o=>'<button class="'+(c.align===o[0]?'on':'')+'" onclick="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'align\',\''+o[0]+'\')">'+o[1]+'</button>').join('');
      const cct=this.cellTypeOfCol(c); const isDrop=(cct==='ddlist'||cct==='ddcustom'||cct==='ddconcat'); const showDef=(cct==='text'||cct==='number'||cct==='date'||cct==='ddcustom');
      const top=[['text','Text'],['number','Number'],['date','Date'],['dropdown','Drop-down'],['multi','Multiple options'],['checkbox','Check box'],['formula','Formula'],['item','From item']];
      let cellPart='<div class="pgrp-t" style="margin:6px 0 6px">Cell type</div><div class="seg2" style="flex-wrap:wrap;gap:6px">'+top.map(o=>{ const active=(o[0]==='dropdown')?isDrop:(cct===o[0]); const target=(o[0]==='dropdown')?(isDrop?cct:'ddlist'):o[0]; return '<button class="'+(active?'on':'')+'" style="flex:1 1 28%" onclick="App.setColCellType(\''+b.id+'\',\''+c.id+'\',\''+target+'\')">'+o[1]+'</button>'; }).join('')+'</div>';
      const colLookup=(v)=>{ const cc=cols.find(x=>x.var===v); if(cc) return cc.num?this.sampleVal(cc):cc.label; const fb=this.state.blocks.find(x=>x.type==='field'&&x.var===v); if(fb) return (fb.inputType==='number'||fb.inputType==='money')?this.sampleFieldVal(fb):fb.label; return this.catalogLabel(v); };
      if(isDrop){
        cellPart+='<div class="prow" style="margin-top:9px"><span class="plab">Type</span><div class="seg2" style="flex-wrap:wrap"><button class="'+(cct==='ddlist'?'on':'')+'" onclick="App.setColCellType(\''+b.id+'\',\''+c.id+'\',\'ddlist\')">Already-available</button><button class="'+(cct==='ddcustom'?'on':'')+'" onclick="App.setColCellType(\''+b.id+'\',\''+c.id+'\',\'ddcustom\')">Create list</button><button class="'+(cct==='ddconcat'?'on':'')+'" onclick="App.setColCellType(\''+b.id+'\',\''+c.id+'\',\'ddconcat\')">⊕ Concatenation</button></div></div>';
        if(cct==='ddlist'){
          const lsk=c.dropSource||'item'; const lsl=(LIST_SOURCES.find(s=>s.k===lsk)||{}).l||'list'; const cnt=this.sourceCount(lsk); const hasData=true;
          cellPart+='<div class="pfield"><label>Select from list</label><select onchange="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'dropSource\',this.value)">'+LIST_SOURCES.map(s=>'<option value="'+s.k+'"'+(lsk===s.k?' selected':'')+'>'+s.l+'</option>').join('')+'</select></div>'+
            '<div class="vb-note">'+(cnt>0?('Uses your '+lsl+' from the accounting app ('+cnt+').'+(lsk==='item'?' Selecting an item fills this row\u2019s “From item” columns.':'')):('No '+lsl.toLowerCase()+' in the accounting app yet — add them in the accounting app.'))+'</div>'+
            (lsk==='item'?'<label class="chk" style="margin-top:8px"><input type="checkbox" '+((c.showQty!==false)?'checked':'')+' onchange="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'showQty\',this.checked)"> Show available qty in the list</label><div class="vb-note">Each option reads e.g. <b>Widget A — Qty: 200</b>.</div>':'');
        } else if(cct==='ddcustom'){
          cellPart+='<div class="vb-note" style="margin:6px 0">Create the drop-down options:</div>'+(c.options||[]).map((o,i)=>'<div class="optrow"><input type="text" value="'+this.esc(o)+'" oninput="App.setColOption(\''+b.id+'\',\''+c.id+'\','+i+',this.value)"><button class="ico del" title="Remove" onclick="App.removeColOption(\''+b.id+'\',\''+c.id+'\','+i+')">✕</button></div>').join('')+'<button class="tbtn" style="width:100%;justify-content:center" onclick="App.addColOption(\''+b.id+'\',\''+c.id+'\')">＋ Add option</button>';
        } else {
          const chips=this.mentionVars({kind:'cconcat',block:b.id,col:c.id}).map(x=>'<button class="fchip" title="inserts: @'+this.esc(x.var)+'" onclick="App.appendCol(\''+b.id+'\',\''+c.id+'\',\'concat\',\' @'+x.var+'\')">'+this.esc(x.label)+'</button>').join('') || '<span class="vb-note">Add more form elements to reference them.</span>';
          const sample=this.concatResolve((c.concat||'').trim(), colLookup);
          cellPart+='<div class="pfield" style="margin-top:6px"><label>Concatenation template</label><input type="text" value="'+this.esc(c.concat||'')+'" placeholder="@accountList - @itemList" oninput="App.mentionInput(this,\'cconcat\',\''+b.id+'\',\''+c.id+'\')" onblur="App.mentionBlur()"></div>'+
            '<div class="vb-note" style="margin-bottom:6px">Type <b>@</b> to insert any form element; add literal text between (e.g. a dash). Click to insert:</div><div class="fchips">'+chips+'</div>'+
            '<div class="vb-note" style="margin-top:6px">Live sample: <b style="color:#0b8a5f">'+this.esc((c.concat||'').trim()?sample:'—')+'</b></div>';
        }
      } else if(cct==='multi'){
        cellPart+='<div class="vb-note" style="margin:6px 0">Create the checkbox options:</div>'+(c.options||[]).map((o,i)=>'<div class="optrow"><input type="text" value="'+this.esc(o)+'" oninput="App.setColOption(\''+b.id+'\',\''+c.id+'\','+i+',this.value)"><button class="ico del" title="Remove" onclick="App.removeColOption(\''+b.id+'\',\''+c.id+'\','+i+')">✕</button></div>').join('')+'<button class="tbtn" style="width:100%;justify-content:center" onclick="App.addColOption(\''+b.id+'\',\''+c.id+'\')">＋ Add option</button>';
      } else if(cct==='checkbox'){
        cellPart+='<label class="chk" style="margin-top:8px"><input type="checkbox" '+(c.defaultValue?'checked':'')+' onchange="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'defaultValue\',this.checked?\'1\':\'\')"> Checked by default</label>';
      } else if(cct==='item'){
        cellPart+='<div class="pfield"><label>Fetch from selected item</label><select onchange="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'itemAttr\',this.value)">'+ITEM_ATTRS.map(a=>'<option value="'+a.k+'"'+((c.itemAttr||'qty')===a.k?' selected':'')+'>'+a.l+'</option>').join('')+'</select></div>'+
          '<div class="vb-note">Auto-filled when an item is chosen in this row\u2019s items drop-down.</div>';
      } else if(cct==='formula'){
        const scope={}; cols.forEach(x=>{ if(x.var) scope[x.var]=this.sampleVal(x); }); this.fieldVars(null).forEach(f=>{ if(scope[f.var]==null) scope[f.var]=this.sampleFieldVal(f); });
        const r=this.evalFormula(c.formula,scope); const sample=c.formula?(r===''?'invalid expression':('= '+r)):'—';
        const chips=this.mentionVars({kind:'cformula',block:b.id,col:c.id}).map(x=>'<button class="fchip" title="inserts: @'+this.esc(x.var)+'" onclick="App.appendCol(\''+b.id+'\',\''+c.id+'\',\'formula\',\' @'+x.var+'\')">'+this.esc(x.label)+'</button>').join('') || '<span class="vb-note">Add more form elements to reference them.</span>';
        cellPart+='<div class="pfield" style="margin-top:8px"><label>Formula</label><input type="text" value="'+this.esc(c.formula||'')+'" placeholder="@qty * @price" oninput="App.mentionInput(this,\'cformula\',\''+b.id+'\',\''+c.id+'\')" onblur="App.mentionBlur()"></div>'+
          '<div class="vb-note" style="margin-bottom:6px">Type <b>@</b> to pick any form element, or click one. Use + − × ÷ and ( ):</div><div class="fchips">'+chips+'</div>'+
          '<div class="vb-note" style="margin-top:6px">Live sample: <b style="color:#0b8a5f">'+this.esc(sample)+'</b></div>';
      }
      const defPart = showDef ? '<div class="pfield"><label>Default value</label><input type="'+(cct==='number'?'number':'text')+'" value="'+this.esc(c.defaultValue||'')+'" placeholder="Default form text" oninput="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'defaultValue\',this.value)"></div>' : '';
      editor='<div class="pgrp"><div class="pgrp-t">Column · '+this.esc(c.label)+'</div>'+
        '<div class="pfield"><label>Label</label><input type="text" value="'+this.esc(c.label)+'" oninput="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'label\',this.value)"></div>'+
        '<div class="pfield"><label>Placeholder</label><input type="text" value="'+this.esc(c.placeholder||'')+'" oninput="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'placeholder\',this.value)"></div>'+
        cellPart+ defPart+
        '<div class="pgrp-t" style="margin:10px 0 6px">Layout</div>'+
        '<div class="prow"><span class="plab">Width</span><span class="unit"><input type="number" value="'+(c.w||0)+'" oninput="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'w\',this.value)"><select onchange="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'wUnit\',this.value)"><option value="px"'+((c.wUnit||'px')==='px'?' selected':'')+'>px</option><option value="%"'+(c.wUnit==='%'?' selected':'')+'>%</option></select></span></div>'+
        '<div class="prow"><span class="plab">Height</span><input class="mini-num" type="number" value="'+(c.h||0)+'" oninput="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'h\',this.value)"><span class="plab" style="min-width:0">Font</span><input class="mini-num" type="number" value="'+(c.fs||0)+'" oninput="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'fs\',this.value)" placeholder="auto"></div>'+
        '<div class="prow"><span class="plab">Style</span><div class="minib"><button class="'+(c.bold?'on':'')+'" onclick="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'bold\','+(c.bold?'false':'true')+')"><b>B</b></button><button class="'+(c.italic?'on':'')+'" onclick="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'italic\','+(c.italic?'false':'true')+')"><i>I</i></button></div></div>'+
        '<div class="prow"><span class="plab">Align</span><div class="minib">'+aseg+'</div></div>'+
        '<label class="chk" style="margin-top:8px"><input type="checkbox" '+((c.printable!==false)?'checked':'')+' onchange="App.lineColSet(\''+b.id+'\',\''+c.id+'\',\'printable\',this.checked)"> Show column in printed voucher</label>'+
        '</div>';
    } else { editor='<div class="vb-note" style="margin:10px 2px">Click a column above — or its header in the table — to set its width, height, font, style, alignment (and, for custom columns, a calculation formula).</div>'; }
    return '<div class="pgrp"><div class="pgrp-t">Columns &amp; order</div><div class="lc-list">'+list+'</div></div>'+
      '<div class="pgrp"><div class="pgrp-t">Add column</div>'+addStd+'<button class="tbtn" style="width:100%;justify-content:center;margin-top:8px" onclick="App.addLineCustomCol()">＋ Add custom column</button></div>'+
      editor+
      '<div class="pgrp"><div class="pgrp-t">Table style (whole section)</div>'+
        '<div class="prow"><span class="plab">Header bg</span>'+this.swatch(b.id,'headBg',b.headBg,true)+'</div>'+
        '<div class="prow"><span class="plab">Header text</span>'+this.swatch(b.id,'headColor',b.headColor,true)+'</div>'+
        '<div class="prow"><span class="plab">Borders</span>'+this.swatch(b.id,'brd',b.brd,true)+'</div>'+
        '<div class="prow"><span class="plab">Stripe rows</span>'+this.swatch(b.id,'stripe',b.stripe,true)+'</div>'+
        '<div class="prow"><span class="plab">Total bg</span>'+this.swatch(b.id,'totBg',b.totBg,true)+'</div>'+
        '<div class="prow"><span class="plab">Total text</span>'+this.swatch(b.id,'totColor',b.totColor,true)+'</div>'+
        '<div class="prow"><span class="plab">Font size</span><input class="mini-num" type="number" value="'+(this.num(b.fs,0)||'')+'" oninput="App.setBlockProp(\''+b.id+'\',\'fs\',this.value)" placeholder="auto"><span class="plab" style="min-width:0">px</span></div>'+
        '<div class="prow"><span class="plab">Cell padding</span><input class="mini-num" type="number" value="'+(this.num(b.pad,0)||'')+'" oninput="App.setBlockProp(\''+b.id+'\',\'pad\',this.value)" placeholder="auto"><span class="plab" style="min-width:0">px</span></div>'+
        '<div class="prow"><span class="plab">Table width</span><span class="unit"><input type="number" value="'+(this.num(b.secW,0)||'')+'" oninput="App.setBlockProp(\''+b.id+'\',\'secW\',this.value)" placeholder="auto"><select onchange="App.setBlockProp(\''+b.id+'\',\'secWUnit\',this.value)"><option value="%"'+((b.secWUnit||'%')==='%'?' selected':'')+'>%</option><option value="px"'+(b.secWUnit==='px'?' selected':'')+'>px</option></select></span></div>'+
        '<div class="prow"><span class="plab">Table height</span><input class="mini-num" type="number" value="'+(this.num(b.secH,0)||'')+'" oninput="App.setBlockProp(\''+b.id+'\',\'secH\',this.value)" placeholder="auto"><span class="plab" style="min-width:0">px</span></div>'+
        '<div class="prow"><span class="plab">Initial rows</span><input class="mini-num" type="number" min="1" value="'+(this.num(b.initRows,0)||1)+'" oninput="App.setBlockProp(\''+b.id+'\',\'initRows\',this.value)"></div>'+
        '<div class="vb-note">Applies to the whole line-items table in the printed &amp; data-entry form.</div></div>'+
      '<div class="pgrp"><button class="tbtn" style="width:100%;justify-content:center;border-color:#f0c0c0;color:var(--danger)" onclick="App.removeBlock(\''+b.id+'\')">🗑 Remove table</button></div>';
  },
  setBlockProp(id,prop,val){ const b=this.state.blocks.find(x=>x.id===id); if(!b) return; const numeric=['height','pad','bw','br','fontSize','widthVal','row','fs','secW','secH','initRows']; b[prop]=numeric.indexOf(prop)>=0?this.num(val,0):val; if(prop==='row') b.row=Math.max(1,this.num(val,1)); if(prop==='inputType'&&(val==='select'||val==='multi')&&(!b.options||!b.options.length)) b.options=['Option 1','Option 2']; this.save(true); this.renderStage(); if(['label','inputType','widthMode','labelPos','inputMode','listSource','autoNumber','row'].indexOf(prop)>=0) this.renderProps(); },
  bumpRow(id,d){ const b=this.state.blocks.find(x=>x.id===id); if(!b) return; b.row=Math.max(1,(b.row||1)+d); this.save(true); this.renderStage(); this.renderProps(); },
  maxRowInGroup(g){ let m=1; (this.state.blocks||[]).forEach(x=>{ if(x.type==='field'&&x.group===g&&(x.row||1)>m) m=(x.row||1); }); return m; },
  normalizeRows(st){ const S=st||this.state; const bl=S.blocks||[]; let i=0; while(i<bl.length){ const b=bl[i]; if(b.type==='lines'){ i++; continue; } const gname=(this.groupOf(b.group)||{}).name||''; let rc=1, j=i; while(j<bl.length && bl[j].type!=='lines' && ((this.groupOf(bl[j].group)||{}).name||'')===gname){ const x=bl[j]; if(x.row===undefined||x.row===null||x.row<1){ if(x.newRow && j>i) rc++; x.row=rc; } else { rc=Math.max(rc,x.row); } j++; } i=j; } },
  cellTypeOf(b){ if(b.inputMode==='amountwords') return 'amountwords'; if(b.inputMode==='party') return 'party'; if(b.inputMode==='formula') return 'formula'; if(b.inputMode==='concat') return 'ddconcat'; if(b.inputMode==='linked') return 'linked'; if(b.inputMode==='dropdown') return 'ddlist'; if(b.inputType==='select') return 'ddcustom'; if(b.inputType==='multi') return 'multi'; if(b.inputType==='checkbox') return 'checkbox'; if(b.inputType==='date') return 'date'; if(b.inputType==='number'||b.inputType==='money') return 'number'; return 'text'; },
  setCellType(id,t){ const b=this.state.blocks.find(x=>x.id===id); if(!b) return;
    if(t==='text'){ b.inputType='text'; b.inputMode='input'; }
    else if(t==='number'){ b.inputType='number'; b.inputMode='input'; }
    else if(t==='date'){ b.inputType='date'; b.inputMode='input'; }
    else if(t==='checkbox'){ b.inputType='checkbox'; b.inputMode='input'; }
    else if(t==='ddlist'){ b.inputMode='dropdown'; if(b.inputType==='select'||b.inputType==='multi'||b.inputType==='checkbox') b.inputType='text'; if(!b.listSource) b.listSource=GROUP_SOURCE[b.group]||'item'; }
    else if(t==='ddcustom'){ b.inputType='select'; b.inputMode='input'; if(!b.options||!b.options.length) b.options=['Option 1','Option 2']; }
    else if(t==='multi'){ b.inputType='multi'; b.inputMode='input'; if(!b.options||!b.options.length) b.options=['Option 1','Option 2']; }
    else if(t==='formula'){ b.inputMode='formula'; }
    else if(t==='concat'||t==='ddconcat'){ b.inputMode='concat'; }
    else if(t==='linked'){ b.inputMode='linked'; }
    else if(t==='party'){ b.inputMode='party'; b.inputType='text'; }
    else if(t==='amountwords'){ b.inputMode='amountwords'; b.inputType='text'; if(!b.wordsSrc) b.wordsSrc='tot:totalWithTax'; }
    this.save(true); this.renderStage(); this.renderProps(); },
  toggleLineColProp(id,c,val){ const b=this.state.blocks.find(x=>x.id===id); if(!b) return; b.cols[c]=val; this.save(true); this.renderStage(); this.renderRail(); },
  removeLineCustom(id,ccid){ const b=this.state.blocks.find(x=>x.id===id); if(!b) return; b.customCols=(b.customCols||[]).filter(c=>c.id!==ccid); this.commit(id); },

  genHTML(){
    const s=this.state; const st=s.style; const P='  ';
    const fieldTag=(b)=>{
      const id='f_'+b.field+'_'+b.id.slice(-4); const req=b.required?' required':''; const istyle=this.elInputStyle(b); const sa=istyle?' style="'+istyle+'"':''; const ent=this.entityOf(b.group); const dv=b.var?(' data-field-var="'+this.esc(b.var)+'"'):'';
      let ctrl;
      if(b.inputMode==='party'){ const other=(b.partyOther!==false); let h2='<div class="party" data-party>\n'; h2+=P+P+P+'<select class="party-type" data-field-var="'+this.esc(b.var)+'_type"><option value="customer">Customer</option><option value="supplier">Supplier</option>'+(other?'<option value="other">Other</option>':'')+'</select>\n'; h2+=P+P+P+'<select data-party-kind="customer">\n'+this.sourceOptionsHtml(P+P+P+P,'customer')+'\n'+P+P+P+'</select>\n'; h2+=P+P+P+'<select data-party-kind="supplier" hidden>\n'+this.sourceOptionsHtml(P+P+P+P,'supplier')+'\n'+P+P+P+'</select>\n'; if(other) h2+=P+P+P+'<input type="text" data-party-kind="other" placeholder="'+this.esc(b.placeholder||'Enter name')+'" hidden>\n'; h2+=P+P+P+'<input type="hidden" id="'+id+'" name="'+id+'"'+dv+' data-party-master>\n'+P+P+'</div>'; ctrl=h2; }
      else if(b.inputMode==='amountwords'){ ctrl='<input type="text" id="'+id+'" name="'+id+'" readonly'+dv+' data-amount-words data-words-src="'+this.esc(b.wordsSrc||'tot:totalWithTax')+'" placeholder="(amount in words)"'+sa+'>'; }
      else if(b.inputMode==='balance'){ ctrl='<input type="text" id="'+id+'" name="'+id+'" readonly'+dv+' data-journal-balance data-bal-debit="'+this.esc(b.balDebit||'amountNoTax')+'" data-bal-credit="'+this.esc(b.balCredit||'totalWithTax')+'" placeholder="(debit vs credit)"'+sa+'>'; }
      else if(b.inputMode==='formula'){ ctrl='<input type="text" id="'+id+'" name="'+id+'" readonly'+dv+' data-fformula="'+this.esc(b.formula||'')+'" placeholder="(calculated)"'+sa+'>'; }
      else if(b.inputMode==='concat'){ ctrl='<input type="text" id="'+id+'" name="'+id+'" readonly'+dv+' data-fconcat="'+this.esc(b.concat||'')+'" placeholder="(combined)"'+sa+'>'; }
      else if(b.inputMode==='linked'&&b.group==='item'){ const at=FIELD_ITEM_ATTR[b.field]||'name'; ctrl='<input type="'+((at==='qty'||at==='sell'||at==='purch'||at==='cost')?'number':'text')+'" id="'+id+'" name="'+id+'" readonly'+dv+' data-item-attr="'+at+'" placeholder="(from selected item)"'+sa+'>'; }
      else if(b.inputMode==='dropdown'){ const ls=b.listSource||'item'; if(ls==='item'){ ctrl='<select id="'+id+'" name="'+id+'"'+dv+' data-item-select'+req+sa+'>\n'+this.itemOptionsHtml(P+P+P+P,(b.showQty!==false))+'\n'+P+P+P+'</select>'; } else if(ls==='account'){ ctrl='<select id="'+id+'" name="'+id+'"'+dv+req+sa+'>\n'+this.accountOptionsHtml(P+P+P+P)+'\n'+P+P+P+'</select>'; } else if(ls==='tax'){ ctrl='<select id="'+id+'" name="'+id+'"'+dv+req+sa+'>\n'+this.taxOptionsHtml(P+P+P+P)+'\n'+P+P+P+'</select>'; } else { ctrl='<select id="'+id+'" name="'+id+'"'+dv+req+sa+'>\n'+this.sourceOptionsHtml(P+P+P+P,ls)+'\n'+P+P+P+'</select>'; } }
      else if(b.inputMode==='linked'){ ctrl='<input type="text" id="'+id+'" name="'+id+'" readonly'+dv+' placeholder="(from selected '+this.esc(ent||'record')+')"'+sa+'>'; }
      else if(b.inputType==='checkbox'){ ctrl='<label class="cbx"><input type="checkbox" id="'+id+'" name="'+id+'" value="1"'+(b.defaultValue?' checked':'')+sa+'> '+this.esc(b.placeholder||'Yes')+'</label>'; }
      else if(b.inputType==='textarea') ctrl='<textarea id="'+id+'" name="'+id+'"'+dv+(b.placeholder?' placeholder="'+this.esc(b.placeholder)+'"':'')+req+sa+'>'+this.esc(b.defaultValue||'')+'</textarea>';
      else if(b.inputType==='select'){ const opts=(b.options||[]); const dvv=b.defaultValue||''; ctrl='<select id="'+id+'" name="'+id+'"'+dv+req+sa+'>\n'+P+P+P+P+'<option value="">Choose…</option>\n'+opts.map(o=>P+P+P+P+'<option'+(o===dvv?' selected':'')+'>'+this.esc(o)+'</option>').join('\n')+'\n'+P+P+P+'</select>'; }
      else if(b.inputType==='multi'){ const opts=(b.options||[]); ctrl='<div class="checks">\n'+opts.map(o=>P+P+P+P+'<label><input type="checkbox" name="'+id+'" value="'+this.esc(o)+'"> '+this.esc(o)+'</label>').join('\n')+'\n'+P+P+P+'</div>'; }
      else { const t={money:'number',tel:'tel',email:'email',date:'date',number:'number'}[b.inputType]||'text'; const step=(b.inputType==='money')?' step="0.01"':''; const isRef=(b.field==='reference'); const refAuto=(isRef&&b.autoNumber!==false); let extra; if(isRef){ extra=refAuto?(' value="'+this.esc(b.defaultValue||'0001')+'" data-auto="1"'):(' placeholder="'+this.esc(b.defaultValue||'0001')+'"'); } else { extra=(b.placeholder?' placeholder="'+this.esc(b.placeholder)+'"':'')+(b.defaultValue?(' value="'+this.esc(b.defaultValue)+'"'):''); } const inp='<input type="'+t+'"'+step+' id="'+id+'" name="'+id+'"'+dv+extra+req+sa+'>'; ctrl=(isRef&&b.initials)?'<div class="input-prefix"><span>'+this.esc(b.initials)+'-</span>'+inp+'</div>':inp; }
      const lp=b.labelPos||'top'; const labelHtml=lp==='hidden'?'':'<label for="'+id+'">'+this.esc(b.label)+(b.required?' *':'')+'</label>';
      const hint=b.hint?'\n'+P+P+P+'<small>'+this.esc(b.hint)+'</small>':'';
      const cls='field'+(lp==='left'?' lp-left':'');
      return P+P+'<div class="'+cls+'" data-print-key="f_'+b.id+'" style="'+this.elWrapStyle(b)+'">\n'+P+P+P+labelHtml+'\n'+P+P+P+ctrl+hint+'\n'+P+P+'</div>';
    };
    const linesTag=(b)=>{ const cols=this.linesCols(b); if(!cols.length) return '';
      const ths=cols.map(c=>{ const cs=this.colWidth(c)+this.colCellStyle(c); return '<th data-print-key="c_'+c.id+'"'+(cs?' style="'+cs+'"':'')+'>'+this.esc(c.label)+'</th>'; }).join('')+'<th class="li-actc"></th>';
      const cell=(c)=>{ const cs=this.colCellStyle(c); const sa=cs?' style="'+cs+'"':''; const dv=c.var?(' data-var="'+this.esc(c.var)+'"'):''; const ph=c.placeholder?(' placeholder="'+this.esc(c.placeholder)+'"'):''; const dval=c.defaultValue||'';
        if(c.cellMode==='formula') return '<input type="number" readonly'+dv+' data-formula="'+this.esc(c.formula||'')+'"'+sa+'>';
        if(c.cellMode==='concat') return '<textarea class="li-grow" readonly rows="1"'+dv+' data-concat="'+this.esc(c.concat||'')+'"'+sa+'></textarea>';
        if(c.cellMode==='dropdown'){ let optsHtml, extra='', phTxt;
          if(c.dropSource==='custom'){ const opts=(c.options||[]); phTxt='Choose…'; optsHtml='<option value="">Choose…</option>'+opts.map(o=>'<option'+(o===dval?' selected':'')+'>'+this.esc(o)+'</option>').join(''); }
          else if(c.dropSource==='account'){ extra=' data-account-col'; phTxt='Choose account'; optsHtml=this.accountOptionsHtml(''); }
          else if(c.dropSource==='tax'){ phTxt='Choose tax'; optsHtml=this.taxOptionsHtml(''); }
          else if(c.dropSource==='item'||!c.dropSource){ extra=' data-item-select'; phTxt='Choose item'; optsHtml=this.itemOptionsHtml('',(c.showQty!==false)); }
          else if(c.dropSource==='subaccount'){ phTxt='— pick account first —'; optsHtml='<option value="">—</option>'; extra=' data-subaccount-col'; return this.lineCombo(optsHtml, dv+extra, phTxt, cs, true); }
          else { const lbl=((LIST_SOURCES.find(s=>s.k===c.dropSource)||{}).l||'item').replace(/s$/,''); phTxt='Choose '+lbl.toLowerCase(); if(c.dropSource==='fixedAsset'||c.dropSource==='intangible') extra=' data-fa-select'; optsHtml=this.sourceOptionsHtml('',c.dropSource); }
          return this.lineCombo(optsHtml, dv+extra, phTxt, cs); }
        if(c.cellMode==='multi'){ const opts=(c.options||[]); return '<div class="checks">'+opts.map(o=>'<label><input type="checkbox" value="'+this.esc(o)+'"> '+this.esc(o)+'</label>').join('')+'</div>'; }
        if(c.cellMode==='checkbox') return '<input type="checkbox" value="1"'+(dval?' checked':'')+sa+'>';
        if(c.cellMode==='date') return '<input type="date"'+dv+(dval?(' value="'+this.esc(dval)+'"'):'')+ph+sa+'>';
        if(c.cellMode==='item'){ const at=c.itemAttr||'qty'; if(at==='name'||at==='code'||at==='unit') return '<textarea class="li-grow" readonly rows="1"'+dv+' data-item-attr="'+this.esc(at)+'"'+sa+'></textarea>'; return '<input type="number" readonly'+dv+' data-item-attr="'+this.esc(at)+'"'+sa+'>'; }
        if(c.num){ const va=dval?(' value="'+this.esc(dval)+'"'):''; const roA=(c.ro?' readonly':''); return '<input type="number" step="0.01"'+roA+dv+va+ph+sa+'>'; }
        return '<textarea class="li-grow" rows="1"'+dv+ph+sa+'>'+this.esc(dval)+'</textarea>'; };
      const tds=cols.map(c=>'<td data-print-key="c_'+c.id+'">'+cell(c)+'</td>').join('')+'<td class="li-actc"><button type="button" class="li-del" title="Remove line" aria-label="Remove line" onclick="delLineRow(this)">✕</button></td>';
      const span=cols.length+1;
      const nums=cols.filter(c=>c.num||c.cellMode==='formula');
      let totRow='';
      if(nums.length){ const fi=cols.findIndex(c=>c.num||c.cellMode==='formula'); const amtCol=cols.find(c=>c.key==='amountNoTax'); let tcells='';
        if(fi>0) tcells+='<td class="li-tot-lbl" colspan="'+fi+'">Total</td>';
        for(let k=fi;k<cols.length;k++){ const cc=cols[k];
          if(cc.cellMode==='dropdown'||cc.key==='taxRate') tcells+='<td'+(' data-print-key="c_'+cc.id+'"')+'></td>';
          else if((cc.num||cc.cellMode==='formula')&&cc.var) tcells+='<td class="li-tot-cell"'+(' data-print-key="c_'+cc.id+'"')+' data-total="'+this.esc(cc.var)+'">0</td>';
          else tcells+='<td'+(' data-print-key="c_'+cc.id+'"')+'></td>';
        }
        tcells+='<td class="li-actc"></td>';
        totRow=P+P+P+P+P+'<tr class="li-tot">'+tcells+'</tr>\n';
      }
      const initN=Math.max(1,(b.initRows||1)); let tbodyRows=''; for(let _k=0;_k<initN;_k++){ tbodyRows+='<tr>'+tds+'</tr>'; }
      return P+P+'<div class="li-wrap">\n'+P+P+P+'<table class="line-items" data-line-items>\n'+P+P+P+P+'<thead><tr>'+ths+'</tr></thead>\n'+P+P+P+P+'<tbody>'+tbodyRows+'</tbody>\n'+P+P+P+P+'<tfoot>\n'+totRow+P+P+P+P+P+'<tr><td class="li-addc" colspan="'+span+'"><button type="button" class="li-add" onclick="addLineRow(this)">＋ Add line</button></td></tr>\n'+P+P+P+P+'</tfoot>\n'+P+P+P+'</table>\n'+P+P+'</div>'; };
    let rows=''; const bl=s.blocks; let i=0;
    while(i<bl.length){ const b=bl[i];
      if(b.type==='lines'){ rows+='\n'+P+'<!-- Line items -->\n'+linesTag(b)+'\n'; i++; continue; }
      const gname=(this.groupOf(b.group)||{}).name||''; const run=[]; let j=i;
      while(j<bl.length && bl[j].type!=='lines' && ((this.groupOf(bl[j].group)||{}).name||'')===gname){ run.push(bl[j]); j++; }
      rows+='\n'+P+'<!-- '+gname+' -->\n';
      const buckets={}, order=[];
      run.forEach(x=>{ const r=(x.row&&x.row>0)?x.row:1; if(!(r in buckets)){ buckets[r]=[]; order.push(r); } buckets[r].push(x); });
      order.sort((a,c)=>a-c);
      order.forEach(r=>{ rows+=P+'<div class="grid-row">\n'+buckets[r].map(x=>fieldTag(x)).join('\n')+'\n'+P+'</div>\n'; });
      i=j;
    }
    let printRows='';
    { const items=[];
      s.blocks.forEach(b=>{ if(b.type==='lines'){ this.linesCols(b).forEach(c=>items.push({k:'c_'+c.id,l:c.label||'Column',on:c.printable!==false})); } else if(b.type==='field'){ items.push({k:'f_'+b.id,l:(b.label||'Field'),on:b.printable!==false}); } });
      if(items.length){ printRows=P+'<!-- Print options -->\n'+P+'<div class="print-opts" data-noprint>\n'+P+P+'<div class="po-h">🖨 Print options — tick the elements to include on the printout</div>\n'+P+P+'<div class="po-grid">\n'+items.map(it=>P+P+P+'<label class="po-item"><input type="checkbox" data-print-target="'+this.esc(it.k)+'"'+(it.on?' checked':'')+'> '+this.esc(it.l)+'</label>').join('\n')+'\n'+P+P+'</div>\n'+P+'</div>\n'; }
    }
    const _lb=s.blocks.find(x=>x.type==='lines'); const liCss=_lb?this.lineSectionCss(_lb,P):'';
    const css='<style>\n'+
      P+'.app-form{'+this.pageStyle()+'box-sizing:border-box}\n'+
      P+'.app-form h2{font-family:inherit;margin:0 0 4px}\n'+
      P+'.app-form .grid{display:flex;flex-direction:column;gap:'+st.gap+'px;margin-top:14px}\n'+
      P+'.app-form .grid-row{display:flex;flex-wrap:wrap;gap:'+st.gap+'px;align-items:flex-start}\n'+
      P+'.app-form .row-break{flex-basis:100%;width:0;height:0;margin:0;padding:0;border:0}\n'+
      P+'.app-form .party{display:flex;gap:8px;flex-wrap:wrap}\n'+
      P+'.app-form .party>.party-type{flex:0 0 150px}\n'+
      P+'.app-form .party>[data-party-kind]{flex:1;min-width:160px}\n'+
      P+'.app-form .field{display:flex;flex-direction:column;gap:6px}\n'+
      P+'.app-form .field.lp-left{flex-direction:row;align-items:center;gap:12px}\n'+
      P+'.app-form .field.lp-left>label{min-width:120px}\n'+
      P+'.app-form label{font-size:13px;font-weight:600}\n'+
      P+'.app-form .print-opts{margin-top:8px;border:1px dashed #cfd6df;border-radius:8px;padding:12px 14px;background:#fbfcfe}\n'+
      P+'.app-form .print-opts .po-h{font-size:12px;font-weight:700;color:#5b6573;margin-bottom:8px}\n'+
      P+'.app-form .print-opts .po-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px 16px}\n'+
      P+'.app-form .print-opts .po-item{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:400;color:#3a4253;cursor:pointer}\n'+
      P+'.app-form .print-opts .po-item input{width:15px;height:15px;margin:0;accent-color:#2563eb;flex:0 0 auto}\n'+
      P+'.app-form small{color:#888;font-size:11px}\n'+
      P+'.app-form input,.app-form textarea,.app-form select{padding:9px 11px;border:1px solid #cbd2db;border-radius:7px;font:inherit;width:100%;box-sizing:border-box}\n'+
      P+'.app-form input[readonly]{background:#f4f6f9;color:#6b7280}\n'+
      P+'.app-form .checks{display:flex;flex-direction:column;gap:6px}\n'+
      P+'.app-form .cbx{display:flex;align-items:center;gap:9px;font:inherit;cursor:pointer}\n'+
      P+'.app-form .cbx input{width:17px;height:17px;accent-color:#2563eb}\n'+
      P+'.app-form .checks label{display:flex;align-items:center;gap:8px;font-weight:400}\n'+
      P+'.app-form .checks input{width:auto}\n'+
      P+'.app-form .input-prefix{display:flex;align-items:stretch}\n'+
      P+'.app-form .input-prefix>span{display:inline-flex;align-items:center;padding:0 11px;background:#eef1f5;border:1px solid #cbd2db;border-right:0;border-radius:7px 0 0 7px;font-weight:600;color:#555;white-space:nowrap}\n'+
      P+'.app-form .input-prefix>input{border-top-left-radius:0;border-bottom-left-radius:0}\n'+
      P+'.app-form .li-wrap{margin-top:10px;border:1px solid #d8dde4;border-radius:8px;overflow:hidden}\n'+
      P+'.app-form .line-items{width:100%;border-collapse:collapse;table-layout:fixed}\n'+
      P+'.app-form .line-items th,.app-form .line-items td{border-bottom:1px solid #e6e9ee;border-right:1px solid #eef1f4;padding:8px 9px;vertical-align:middle}\n'+
      P+'.app-form .line-items th:last-child,.app-form .line-items td:last-child{border-right:0}\n'+
      P+'.app-form .line-items thead th{background:#f6f8fa;text-align:left;font-weight:600;font-size:12.5px;color:#3a4253}\n'+
      P+'.app-form .line-items tbody tr:hover{background:#f9fbfd}\n'+
      P+'.app-form .line-items td input,.app-form .line-items td select{width:100%;border:1px solid #e0e4ea;border-radius:6px;padding:6px 8px;font:inherit;box-sizing:border-box;background:#fff}\n'+
      P+'.app-form .line-items td textarea{width:100%;min-width:120px;border:1px solid #e0e4ea;border-radius:6px;padding:6px 8px;font:inherit;box-sizing:border-box;background:#fff;resize:none;overflow:hidden;white-space:pre-wrap;word-break:break-word;min-height:34px;line-height:1.35;display:block}\n'+
      P+'.app-form .line-items td textarea[readonly]{background:#eef6f1;color:#0b6b49;font-weight:600;border-color:#d6ece1}\n'+
      P+'.app-form .line-items td input[readonly]{background:#eef6f1;color:#0b6b49;font-weight:600;border-color:#d6ece1}\n'+
      P+'.app-form .line-items td select[disabled]{background:#eef1f5;color:#5b6573;border-color:#d8dde4;cursor:not-allowed}\n'+
      P+'.app-form .li-actc{width:44px;text-align:center;background:#f8fafc}\n'+
      P+'.app-form .li-del{width:27px;height:27px;border:1px solid #e3c6c6;background:#fff;color:#c0504d;border-radius:6px;cursor:pointer;font-size:13px;line-height:1;display:inline-flex;align-items:center;justify-content:center;transition:.12s}\n'+
      P+'.app-form .li-del:hover{background:#fbeaea;border-color:#d98f8f}\n'+
      P+'.app-form .li-addc{background:#fbfcfe;padding:8px 9px}\n'+
      P+'.app-form .line-items td select{white-space:normal;word-break:break-word}\n'+
      P+'.app-form .line-items .li-actc{width:34px}\n'+
      P+'.app-form .li-wrap{overflow-x:auto;max-width:100%}\n'+
      P+'.app-form .li-combo{position:relative;width:100%}\n'+
      P+'.app-form .li-combo-val{min-height:34px;box-sizing:border-box;padding:7px 26px 7px 10px;border:1px solid #e0e4ea;border-radius:6px;background:#fff;white-space:pre-wrap;word-break:break-word;line-height:1.35;color:#222;cursor:pointer}\n'+
      P+'.app-form .li-combo-val.placeholder{color:#9aa3b2}\n'+
      P+'.app-form .li-combo-val.locked{background:#eef6f1;color:#0b6b49;font-weight:600;border-color:#d6ece1}\n'+
      P+'.app-form .li-combo::after{content:"\\25BE";position:absolute;right:9px;top:9px;color:#5b6573;pointer-events:none;font-size:12px}\n'+
      P+'.app-form .li-combo-sel{position:absolute;left:0;top:0;width:100%;height:100%;opacity:0;cursor:pointer;border:0;margin:0;padding:0}\n'+
      P+'.app-form .line-items tfoot .li-tot td{background:#f3f6fa;font-weight:700;color:#243043;border-top:2px solid #cdd6e0;padding:9px}\n'+
      P+'.app-form .line-items tfoot .li-tot .li-tot-lbl{text-align:right;color:#5b6573;font-weight:700}\n'+
      P+'.app-form .line-items tfoot .li-tot .li-tot-cell{text-align:right}\n'+
      P+'.app-form .li-add{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border:1px solid #cfd6df;background:#fff;border-radius:7px;cursor:pointer;font:inherit;font-weight:600;color:#0b6b49;transition:.12s}\n'+
      P+'.app-form .li-add:hover{border-color:#2563eb;background:#e8f0fe}\n'+
      P+'.app-form button[type=submit]{margin-top:16px;padding:10px 20px;border:0;border-radius:11px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}\n'+
      liCss+
      P+'@media print{ .app-form [data-noprint]{display:none !important} .app-form .pr-off{display:none !important} .app-form .li-actc, .app-form .li-addc, .app-form .li-add{display:none !important} }\n</style>';
    const hasLines = s.blocks.some(b=>b.type==='lines' && this.linesCols(b).length);
    const hasFieldFormula = s.blocks.some(b=>b.type==='field' && b.inputMode==='formula');
    const hasItem = s.blocks.some(b=>(b.type==='field'&&b.group==='item'&&(b.inputMode==='dropdown'||b.inputMode==='linked')) || (b.type==='lines'&&this.linesCols(b).some(c=>c.cellMode==='dropdown'&&c.dropSource!=='accounts'||c.cellMode==='item')));
    const hasConcat = s.blocks.some(b=>(b.type==='field'&&b.inputMode==='concat') || (b.type==='lines'&&this.linesCols(b).some(c=>c.cellMode==='concat')));
    const hasParty = s.blocks.some(b=>b.type==='field' && b.inputMode==='party');
    const hasWords = s.blocks.some(b=>b.type==='field' && b.inputMode==='amountwords');
    const need = hasLines||hasFieldFormula||hasItem||hasConcat||hasParty||hasWords||(s.blocks&&s.blocks.length>0);
    const script = need ? ('\n<scr'+'ipt>\n(function(){\n'+
      '  function grow(el){ if(!el||!el.style) return; el.style.height="auto"; el.style.height=(el.scrollHeight)+"px"; }\n'+
      '  function ev(expr,scope){ try{ var s=String(expr||"").replace(/@/g,"").replace(/[a-zA-Z_][a-zA-Z0-9_]*/g,function(m){ var v=scope[m]; return (v!=null&&v!=="")?("("+Number(v)+")"):"0"; }); if(!/^[-0-9+*\\/().\\s]*$/.test(s)) return ""; var r=Function("return ("+s+")")(); return isFinite(r)?(Math.round(r*100)/100):""; }catch(e){ return ""; } }\n'+
      '  function cat(t,scope){ return String(t||"").replace(/@([A-Za-z_][A-Za-z0-9_]*)/g,function(m,v){ var x=scope[v]; return (x==null)?"":x; }); }\n'+
      '  function fmtT(x){ if(!isFinite(x)) return ""; return (Math.round(x*100)/100); }\n'+
      '  function n2wInt(n){ n=Math.floor(Math.abs(n)); if(n===0) return "Zero"; var a=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"]; var b=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"]; function three(x){ var s=""; var h=Math.floor(x/100), r=x%100; if(h){ s+=a[h]+" Hundred"; if(r) s+=" "; } if(r){ if(r<20) s+=a[r]; else { s+=b[Math.floor(r/10)]; if(r%10) s+="-"+a[r%10]; } } return s; } var u=["","Thousand","Million","Billion","Trillion"]; var i=0,out=""; while(n>0){ var g=n%1000; if(g){ out=three(g)+(u[i]?(" "+u[i]):"")+(out?(" "+out):""); } n=Math.floor(n/1000); i++; } return out; }\n'+
      '  function amountWords(v){ if(v==null||v===""||isNaN(v)) return ""; var num=Number(v); var sign=num<0?"Minus ":""; var w=Math.floor(Math.abs(num)); var c=Math.round((Math.abs(num)-w)*100); if(c===100){ w+=1; c=0; } return sign+n2wInt(w)+" and "+(c<10?"0"+c:""+c)+"/100"; }\n'+
      '  function updateAmountWords(form){ form.querySelectorAll("[data-amount-words]").forEach(function(el){ var src=el.getAttribute("data-words-src")||"tot:totalWithTax"; var val=NaN; if(src.indexOf("tot:")===0){ var key=src.slice(4); var cell=(key==="tax")?form.querySelector("[data-total-tax]"):form.querySelector(\'[data-total="\'+key+\'"]\'); if(!cell) cell=form.querySelector(\'[data-total="totalWithTax"]\')||form.querySelector(\'[data-total="amountNoTax"]\')||form.querySelector("[data-total]"); if(cell) val=parseFloat((cell.textContent||"").replace(/[^0-9.-]/g,"")); } else if(src.indexOf("fld:")===0){ var v=src.slice(4); var f=form.querySelector(\'[data-field-var="\'+v+\'"]\'); if(f) val=parseFloat(f.value); } el.value=amountWords(val); }); }\n'+
      '  function syncCombo(sel){ if(!sel||!sel.parentNode) return; var box=sel.parentNode.querySelector("[data-combo-val]"); if(!box) return; var opt=sel.options[sel.selectedIndex]; var txt=opt?(opt.textContent||"").replace(/\\s+/g," ").trim():""; var ph=sel.getAttribute("data-ph")||""; if(sel.value===""||txt===""){ box.textContent=ph; box.className="li-combo-val placeholder"+(sel.disabled?" locked":""); } else { box.textContent=txt; box.className="li-combo-val"+(sel.disabled?" locked":""); } }\n'+
      '  function recomputeTotals(t){ var foot=t.tFoot; if(!foot||!t.tBodies[0]) return; var rows=t.tBodies[0].rows; foot.querySelectorAll("[data-total]").forEach(function(td){ var v=td.getAttribute("data-total"); var sum=0; Array.prototype.forEach.call(rows,function(r){ var el=r.querySelector(\'[data-var="\'+v+\'"]\'); if(el){ var n=parseFloat(el.value); if(!isNaN(n)) sum+=n; } }); td.textContent=fmtT(sum); }); foot.querySelectorAll("[data-total-tax]").forEach(function(td){ var av=td.getAttribute("data-amt-var"), rv=td.getAttribute("data-rate-var"); var sum=0; Array.prototype.forEach.call(rows,function(r){ var ae=r.querySelector(\'[data-var="\'+av+\'"]\'), re=r.querySelector(\'[data-var="\'+rv+\'"]\'); var a=ae?parseFloat(ae.value):NaN, rt=re?parseFloat(re.value):NaN; if(!isNaN(a)&&!isNaN(rt)) sum+=a*rt/100; }); td.textContent=fmtT(sum); }); var __f=t.closest&&t.closest(".app-form"); if(__f) updateAmountWords(__f); }\n'+
      '  function recomputeRow(row){ var form=row.closest(".app-form"); for(var p=0;p<4;p++){ var sc={}; if(form){ form.querySelectorAll("[data-field-var]").forEach(function(i){ sc[i.getAttribute("data-field-var")]=i.value; }); } row.querySelectorAll("[data-var]").forEach(function(i){ sc[i.getAttribute("data-var")]=i.value; }); row.querySelectorAll("[data-formula]").forEach(function(f){ var nv=ev(f.getAttribute("data-formula"),sc); f.value=nv; var k=f.getAttribute("data-var"); if(k!=null) sc[k]=nv; }); row.querySelectorAll("[data-concat]").forEach(function(f){ var nv=cat(f.getAttribute("data-concat"),sc); f.value=nv; var k=f.getAttribute("data-var"); if(k!=null) sc[k]=nv; if(f.classList&&f.classList.contains("li-grow")) grow(f); }); } }\n'+
      '  function recomputeForm(form){ for(var p=0;p<4;p++){ var sc={}; form.querySelectorAll("[data-field-var]").forEach(function(i){ sc[i.getAttribute("data-field-var")]=i.value; }); form.querySelectorAll("[data-fformula]").forEach(function(f){ var e=(f.getAttribute("data-fformula")||"").replace(/@/g,"").trim(); var nv; if(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(e)){ var s2=sc[e]; nv=(s2!=null?s2:""); } else { nv=ev(e,sc); } f.value=nv; var k=f.getAttribute("data-field-var"); if(k!=null) sc[k]=nv; }); form.querySelectorAll("[data-fconcat]").forEach(function(f){ var nv=cat(f.getAttribute("data-fconcat"),sc); f.value=nv; var k=f.getAttribute("data-field-var"); if(k!=null) sc[k]=nv; }); } updateAmountWords(form); }\n'+
      '  function setAccount(sel,name){ var f=false; for(var i=0;i<sel.options.length;i++){ if(sel.options[i].value===name||sel.options[i].text===name){ sel.selectedIndex=i; f=true; break; } } if(!f){ var o=document.createElement("option"); o.value=name; o.text=name; sel.appendChild(o); sel.value=name; } }\n'+
      '  function fillItem(sel){ var opt=sel.options[sel.selectedIndex]; if(!opt) return; syncCombo(sel); var tr=sel.closest("tr"); var scope=tr||sel.closest(".app-form"); if(!scope) return; scope.querySelectorAll("[data-item-attr]").forEach(function(t){ var a=t.getAttribute("data-item-attr"); var v=opt.getAttribute("data-"+a); if(v!=null) t.value=v; if(t.classList&&t.classList.contains("li-grow")) grow(t); }); if(tr){ var ac=tr.querySelector("[data-account-col]"); if(ac){ if(sel.value!==""){ var _af=sel.closest(".app-form"); var _p=_af&&_af.getAttribute("data-doc-kind")==="purchase"; setAccount(ac,_p?"Inventory on hand":"Inventory - sales"); ac.disabled=true; } else { ac.disabled=false; ac.selectedIndex=0; } syncCombo(ac); } recomputeRow(tr); } else { var f=sel.closest(".app-form"); if(f) recomputeForm(f); } }\n'+      '  function fillFaRow(sel){ syncCombo(sel); var tr=sel.closest("tr"); if(!tr) return; var o=sel.options[sel.selectedIndex]; if(!o) return; var m=[["data-facost","cost"],["data-faaccdep","accDep"]]; for(var i=0;i<m.length;i++){ var c=tr.querySelector(\'[data-var="\'+m[i][1]+\'"]\'); var v=o.getAttribute(m[i][0]); if(c&&v!=null&&v!==""){ c.value=v; } } recomputeRow(tr); var f=sel.closest(".app-form"); if(f) recomputeDepr(f); }\n'+
      '  function recomputeDepr(form){ var mEl=form.querySelector(\'[data-field-var="depMethod"]\'); if(!mEl) return; var reducing=/reduc/i.test(mEl.value||""); form.querySelectorAll("[data-line-items]").forEach(function(t){ if(!t.tBodies[0]) return; Array.prototype.forEach.call(t.tBodies[0].rows,function(tr){ function g(v){ var el=tr.querySelector(\'[data-var="\'+v+\'"]\'); return el?(parseFloat(el.value)||0):0; } function st(v,val){ var el=tr.querySelector(\'[data-var="\'+v+\'"]\'); if(el){ el.value=(!isFinite(val))?"":(Math.round(val*100)/100); } } var cost=g("cost"),acc=g("accDep"),rate=g("depRate"); var base=reducing?(cost-acc):cost; var exp=base*rate/100; st("depExpense",exp); st("wdv",cost-acc-exp); }); recomputeTotals(t); }); }\n'+

      '  window.addLineRow=function(btn){ var t=btn.closest("table"); var tb=t.tBodies[0]; var r=tb.rows[0].cloneNode(true); r.querySelectorAll("input").forEach(function(i){ if(i.type==="checkbox") i.checked=false; else i.value=""; }); r.querySelectorAll("textarea").forEach(function(x){ if(!x.readOnly) x.value=""; x.style.height=""; }); r.querySelectorAll("select").forEach(function(s){ s.disabled=false; s.selectedIndex=0; }); tb.appendChild(r); recomputeRow(r); r.querySelectorAll(".li-combo-sel").forEach(syncCombo); r.querySelectorAll(".li-grow").forEach(grow); recomputeTotals(t); var _af=t.closest&&t.closest(".app-form"); if(_af){ applyPrintToggles(_af); recomputeDepr(_af); } };\n'+
      '  window.delLineRow=function(btn){ var tr=btn.closest("tr"); var tb=tr.parentNode; var _t=btn.closest("table"); if(tb.rows.length>1){ tb.removeChild(tr); } else { tr.querySelectorAll("input").forEach(function(i){ if(i.type==="checkbox") i.checked=false; else i.value=""; }); tr.querySelectorAll("textarea").forEach(function(x){ if(!x.readOnly) x.value=""; x.style.height=""; }); tr.querySelectorAll("select").forEach(function(s){ s.disabled=false; s.selectedIndex=0; }); recomputeRow(tr); } if(_t) recomputeTotals(_t); };\n'+
      '  document.querySelectorAll("[data-line-items]").forEach(function(t){ t.addEventListener("input",function(e){ var row=e.target.closest("tr"); if(row) recomputeRow(row); if(e.target.classList&&e.target.classList.contains("li-grow")) grow(e.target); recomputeTotals(t); }); t.addEventListener("change",function(e){ if(e.target.matches&&e.target.matches("[data-item-select]")) fillItem(e.target); else if(e.target.matches&&e.target.matches("[data-fa-select]")) fillFaRow(e.target); if(e.target.classList&&e.target.classList.contains("li-combo-sel")) syncCombo(e.target); recomputeTotals(t); }); Array.prototype.forEach.call(t.tBodies[0].rows,function(row){ recomputeRow(row); }); t.querySelectorAll(".li-combo-sel").forEach(syncCombo); t.querySelectorAll(".li-grow").forEach(grow); recomputeTotals(t); });\n'+
      '  document.querySelectorAll("[data-party]").forEach(function(p){ var t=p.querySelector(".party-type"); var master=p.querySelector("[data-party-master]"); function active(){ return p.querySelector("[data-party-kind=\\""+t.value+"\\"]"); } function sync(){ var a=active(); if(master&&a) master.value=(a.value||""); } function upd(){ p.querySelectorAll("[data-party-kind]").forEach(function(el){ var on=(el.getAttribute("data-party-kind")===t.value); if(on){ el.removeAttribute("hidden"); el.disabled=false; } else { el.setAttribute("hidden",""); el.disabled=true; } }); sync(); } t.addEventListener("change",upd); p.addEventListener("input",sync); p.addEventListener("change",sync); upd(); });\n'+
      '  function applyPrintToggles(form){ if(!form) return; form.querySelectorAll("[data-print-target]").forEach(function(cb){ var key=cb.getAttribute("data-print-target"); var off=!cb.checked; form.querySelectorAll(\'[data-print-key="\'+key+\'"]\').forEach(function(el){ if(off){ el.classList.add("pr-off"); } else { el.classList.remove("pr-off"); } }); }); }\n'+
      '  document.querySelectorAll("[data-print-target]").forEach(function(cb){ cb.addEventListener("change",function(){ applyPrintToggles(cb.closest(".app-form")); }); });\n'+
      '  (function(){ var f=document.querySelector(".app-form"); if(f) applyPrintToggles(f); })();\n'+
      '  var form=document.querySelector(".app-form");\n'+
      '  if(form){ form.addEventListener("input",function(){ recomputeForm(form); recomputeDepr(form); }); form.addEventListener("change",function(e){ if(e.target.matches&&e.target.matches("[data-item-select]")&&!e.target.closest("tr")) fillItem(e.target); recomputeDepr(form); }); recomputeForm(form); recomputeDepr(form); }\n'+
      '})();\n</scr'+'ipt>') : '';
    return '<!-- '+this.esc(s.title)+' -->\n'+css+'\n<form class="app-form">\n'+P+'<h2>'+this.esc(s.title)+'</h2>'+(s.subtitle?'\n'+P+'<p>'+this.esc(s.subtitle)+'</p>':'')+'\n'+P+'<div class="grid">\n'+rows+printRows+P+'</div>\n'+'</form>'+script;
  },
  exportHTML(){ const html=this.genHTML(); const blob=new Blob([html],{type:'text/html'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(this.state.title||'form').replace(/[^\w\-]+/g,'_').toLowerCase()+'.html'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); },

  defaultStyle(){ return { widthMode:'max', width:760, heightMode:'auto', height:600, bg:'#ffffff', fontSize:14, fontColor:'#222222', fontFamily:'system', bw:1, bc:'#e4e7ec', br:14, pad:34, gap:16 }; },
  freshState(){ return { title:'Untitled form', subtitle:'', style:this.defaultStyle(), data:this.shared, blocks:[] }; },
  starter(key){ const def=STARTERS[key]||STARTERS.custom; const s=this.freshState(); s.title=def.title||'Untitled form';
    const addField=(pp)=>{ const grp=this.groupOf(pp[0]); const ov=pp[2]||null; let it=grp&&grp.items.find(x=>x.f===pp[1]); let blk;
      if(it){ blk=this.newField(pp[0],pp[1],it.label,it.type); }
      else if(pp[1]==='custom'){ blk=this.newField(pp[0],'custom',(ov&&ov.label)||'Field',(ov&&ov.inputType)||'text'); blk.custom=true; blk.var=(ov&&ov.var)||this.slugVar((ov&&ov.label)||'field'); }
      else { return; }
      if(ov){ Object.assign(blk, ov); } s.blocks.push(blk); };
    (def.fields||[]).forEach(addField);
    if(def.lines&&def.lines.length){ const lb={id:this.uid(),type:'lines',columns:[]}; if(def.lineRows) lb.initRows=def.lineRows; def.lines.forEach(entry=>{ const ck=Array.isArray(entry)?entry[0]:entry; const ov=Array.isArray(entry)?entry[1]:null; const it=PALETTE.find(g=>g.isLines).items.find(x=>x.c===ck); const col=this.newCol(ck, it?it.label:ck, it?it.num:false); if(ov) Object.assign(col, ov); lb.columns.push(col); }); s.blocks.push(lb); }
    (def.tail||[]).forEach(addField);
    const TXN={salesInv:1,purchInv:1,salesQuotes:1,purchQuotes:1,salesOrders:1,purchOrders:1,deliveryNotes:1,creditNotes:1,debitNotes:1,receipts:1,payments:1,iat:1,journal:1,goodsRec:1,payslips:1,depreciation:1};
    if(TXN[key] && !s.blocks.some(b=>b.field==='custom'&&b.var==='narration')){ const nb=this.newField('general','custom','Narration','text'); nb.custom=true; nb.var='narration'; nb.inputType='textarea'; nb.height=64; nb.widthMode='full'; const wi=s.blocks.findIndex(b=>b.inputMode==='amountwords'); if(wi<0) s.blocks.push(nb); else s.blocks.splice(wi,0,nb); }
    return s; },
  save(){ try{ if(this.docType) this.docs[this.docType]=this.state; const docsOut={}; Object.keys(this.docs).forEach(k=>{ docsOut[k]=Object.assign({}, this.docs[k], {data:undefined}); }); localStorage.setItem('formHtmlEditor_v2', JSON.stringify({v:2, active:this.docType, shared:this.shared, docs:docsOut})); }catch(e){} },
  load(){ try{
      this.shared=this.shared||{items:[],accounts:[],taxes:DEFAULT_TAXES.map(t=>({name:t.name,rate:t.rate}))};
      const raw=localStorage.getItem('formHtmlEditor_v2');
      if(raw){ const blob=JSON.parse(raw)||{}; this.shared=Object.assign({items:[],accounts:[],taxes:DEFAULT_TAXES.map(t=>({name:t.name,rate:t.rate}))}, blob.shared||{}); this.docs={}; const ks=Object.keys(blob.docs||{}); ks.forEach(k=>{ const s=Object.assign(this.freshState(), blob.docs[k]); s.style=Object.assign({}, this.defaultStyle(), s.style||{}); s.data=this.shared; if(!Array.isArray(s.blocks)) s.blocks=[]; this.docs[k]=s; }); this.docType=blob.active||ks[0]||'salesInv'; if(!this.docs[this.docType]) this.docs[this.docType]=this.starter(this.docType); this.state=this.docs[this.docType]; return; }
      const old=localStorage.getItem('formHtmlEditor_v1');
      if(old){ const s=JSON.parse(old); if(s&&Array.isArray(s.blocks)){ this.shared=Object.assign(this.shared, s.data||{}); s.style=Object.assign({}, this.defaultStyle(), s.style||{}); s.data=this.shared; this.docs={custom:s}; this.docType='custom'; this.state=s; return; } }
      this.docs={}; this.docType='salesInv'; this.state=this.starter('salesInv'); this.docs.salesInv=this.state;
    }catch(e){ this.shared=this.shared||{items:[],accounts:[],taxes:[]}; this.docs=this.docs||{}; if(!this.docType){ this.docType='salesInv'; this.state=this.starter('salesInv'); this.docs.salesInv=this.state; } } },
  renderDocSelect(){ const sel=document.getElementById('docSelect'); if(!sel) return; sel.innerHTML=DOC_TYPES.map(d=>'<option value="'+d.k+'"'+(d.k===this.docType?' selected':'')+'>'+this.esc(d.l)+(this.docs[d.k]?'  ✓':'')+'</option>').join(''); },
  switchDoc(key){ if(key===this.docType) return; this.docs[this.docType]=this.state; this.save(); this.docType=key; if(!this.docs[key]) this.docs[key]=this.starter(key); this.state=this.docs[key]; this.migrateBlocks(this.state); this.sel=null; this.selCol=null; this._drag=null; this.renderDocSelect(); this.renderRail(); this.renderStage(); this.renderProps(); },
  publishBundle(silent){ this.docs[this.docType]=this.state; const templates={}; const prevState=this.state, prevType=this.docType;
    Object.keys(this.docs).forEach(k=>{ this.state=this.docs[k]; const label=(DOC_TYPES.find(d=>d.k===k)||{}).l||k; templates[k]={ key:k, label:label, title:this.state.title, html:this.genHTML(), state:Object.assign({}, this.state, {data:undefined}) }; });
    this.state=prevState; this.docType=prevType;
    const bundle={ app:'form-html-editor', version:2, generatedAt:new Date().toISOString(), shared:this.shared, templates:templates };
    const json=JSON.stringify(bundle,null,2); try{ localStorage.setItem('mgr_form_templates', json); }catch(e){}
    const embedded=(window.parent && window.parent!==window);
    if(embedded){ try{ window.parent.postMessage({type:'mgr-form-bundle', bundle:bundle}, '*'); }catch(e){} if(!silent) alert('Published '+Object.keys(templates).length+' form design(s) to the accounting app.'); return; }
    const blob=new Blob([json],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='accounting-form-templates.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    if(!silent) alert('Published '+Object.keys(templates).length+' form design(s).\nA bundle file (accounting-form-templates.json) was downloaded — in the accounting app open Settings → Form Designs → Import.'); },
  updateExit(){ this.publishBundle(true); if(window.__fedExit){ try{ window.__fedExit(); return; }catch(e){} } if(window.parent && window.parent!==window){ try{ window.parent.postMessage({type:'mgr-form-done'}, '*'); }catch(e){} } },
  resetDefault(){ if(!confirm('Reset this document to its default layout? Your changes to this document will be lost.')) return; this.docs[this.docType]=this.starter(this.docType); this.state=this.docs[this.docType]; this.sel=null; this.selCol=null; this.migrateBlocks(this.state); this.save(true); this.renderDocSelect(); this.renderRail(); this.renderStage(); this.renderProps(); },
  clearForm(){ if(!confirm('Clear this document’s form? This removes all its fields.')) return; this.state.blocks=[]; this.sel=null; this.selCol=null; this.commit(); },
  openDocByKey(key){ const k=DOC_TYPES.some(d=>d.k===key)?key:'custom'; if(k===this.docType){ this.renderDocSelect(); return; } this.switchDoc(k); },
  announceReady(){ try{ if(window.parent && window.parent!==window) window.parent.postMessage({type:'mgr-editor-ready'}, '*'); }catch(e){} },
};
window.addEventListener('message', function(ev){ var d=ev&&ev.data; if(!d) return; if(d.type==='mgr-open-doc'&&d.key){ App.openDocByKey(d.key); } else if(d.type==='mgr-app-lists'){ App.appLists=d.lists||null; if(App.renderRail){ App.renderRail(); App.renderStage(); App.renderProps(); } } });
window.addEventListener('DOMContentLoaded', function(){ try{ if(window.parent && window.parent!==window) document.body.classList.add('embedded'); }catch(e){} App.init(); App.announceReady(); });

