import{c as M,a as B,r as y,b as D,j as e,P as C}from"./index-CPGrsRq5.js";import{A as H}from"./arrow-left-AWXGeXGp.js";import{P as I}from"./printer-CNYQELCa.js";function Y(){const{id:p}=M(),c=B(),[n,z]=y.useState(null),[v,w]=y.useState(null);y.useEffect(()=>{D.get(`/hms/rest-forms/${p}`).then(async t=>{const s=t.data;if(z(s),s.patient_id)try{const d=await D.get(`/patients/${s.patient_id}`),a=d.data.patient||d.data;w({name:a.name||a.NAME||s.patient_name||"",empNumber:a.empNumber||a.EMPNUMBER||s.emp_number||"",relationship:a.relationship||a.RELATIONSHIP||s.relationship||""})}catch{w({name:s.patient_name||"",empNumber:s.emp_number||"",relationship:s.relationship||""})}}).catch(t=>console.error(t))},[p]);const j=(t,s)=>{const d=(s==null?void 0:s.name)||t.patient_name||"",a=(s==null?void 0:s.empNumber)||t.emp_number||"",r=t.attended_date?new Date(t.attended_date):null,x=r?r.toLocaleDateString("en-GB"):"............",f=r?r.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",hour12:!0}):"......",m=t.from_date?new Date(t.from_date).toLocaleDateString("en-GB"):"............",g=t.to_date?new Date(t.to_date).toLocaleDateString("en-GB"):"............",h=t.fit_date?new Date(t.fit_date).toLocaleDateString("en-GB"):"............",P=t.extended_date?new Date(t.extended_date).toLocaleDateString("en-GB"):null,L=new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}).toUpperCase();return{name:d,empNo:a,attendedDateStr:x,attendedTimeStr:f,fromDate:m,toDate:g,fitDate:h,extendedDate:P,formDate:L}},N=()=>{if(!n)return;const{name:t,empNo:s,attendedDateStr:d,attendedTimeStr:a,fromDate:r,toDate:x,fitDate:f,extendedDate:m,formDate:g}=j(n,v),h=window.open("","_blank");h.document.write(`
      <html>
      <head>
        <title>Rest Form - ${t}</title>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Noto Sans Devanagari', 'Times New Roman', serif; color: #111; line-height: 1.5; font-size: 12pt; }
          .page { width: 210mm; margin: 0 auto; padding: 12mm 18mm; }

          .header-wrap { display: flex; align-items: center; justify-content: center; position: relative; margin-bottom: 7mm; min-height: 130px; }
          .header-logo { position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 130px; height: 130px; object-fit: contain; }
          .header-text { text-align: center; z-index: 1; }
          .header-text .h1 { font-size: 15pt; font-weight: 700; }
          .header-text .h2 { font-size: 12pt; font-weight: 600; margin-top: 3px; }

          .booksr { display: flex; justify-content: space-between; margin-bottom: 6mm; font-size: 11.5pt; }

          /* KEY FIX: flexWrap: nowrap so sentences never break mid-line */
          .row { display: flex; align-items: flex-end; flex-wrap: nowrap; margin-bottom: 5mm; line-height: 2; }
          .lbl { white-space: nowrap; font-size: 11.5pt; }
          .val {
            color: #1a237e; font-weight: 700; font-size: 13pt;
            border-bottom: 1px dotted #555;
            padding: 0 6px; display: inline-block; text-align: center; min-width: 40px;
          }
          .val-red { color: #c62828; font-weight: 800; font-size: 16pt; border-bottom: 2px dotted #c62828; }

          .center-section { text-align: center; margin: 8mm 0; font-size: 13.5pt; font-weight: 600; }
          .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 14mm; }
          .footer-date { font-size: 13pt; font-weight: 700; color: #c62828; }
          .footer-sign { text-align: center; font-size: 11pt; }
          .sign-line { width: 170px; border-bottom: 1.2px solid #333; margin-bottom: 5px; }
          .copyright { text-align: center; font-size: 8pt; color: #666; margin-top: 10mm; }

          @media print {
            body { -webkit-print-color-adjust: exact; }
            .page { padding: 8mm 12mm; }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="header-wrap">
            <img src="${window.location.origin}/logo.png" class="header-logo" />
            <div class="header-text">
              <div class="h1">अस्पताल प्रबंधन प्रणाली</div>
              <div class="h1">HOSPITAL MEDICAL CENTRE</div>
              <div class="h2">चिकित्सा विभाग MEDICAL DEPARTMENT</div>
              <div class="h2">रेस्ट फार्म REST FORM</div>
            </div>
          </div>

          <div class="booksr">
            <div>Sr. No. &nbsp;<span class="val val-red" style="min-width:110px">${n.sr_no||"........"}</span></div>
          </div>

          <div class="row">
            <span class="lbl">श्री / Shri.&nbsp;</span>
            <span class="val" style="flex:1; min-width:160px">${t}</span>
            <span class="lbl">&nbsp;&nbsp;कार्यरत / working as&nbsp;</span>
            <span class="val" style="min-width:120px">${n.working_as||"............"}</span>
            <span class="lbl">&nbsp;में / in&nbsp;</span>
            <span class="val" style="min-width:120px">${n.department||"............"}</span>
          </div>

          <div class="row">
            <span class="lbl">अनुभाग व विभाग क्रम.स० (Section or Department) E. No.:&nbsp;</span>
            <span class="val" style="flex:1">${s||"............"}</span>
          </div>

          <div class="row">
            <span class="lbl">मुख्य अस्पताल/प्रा० स्वा० के०में उपस्थित हुआ attended Main Hospital/FAP on&nbsp;</span>
            <span class="val" style="min-width:130px">${d}</span>
            <span class="lbl">&nbsp;दिनांक / Date</span>
          </div>

          <div class="row">
            <span class="lbl">को / at&nbsp;</span>
            <span class="val" style="min-width:110px">${a}</span>
            <span class="lbl">&nbsp;ए.एम./पी.एम. a.m./p.m.</span>
          </div>

          <div class="row">
            <span class="lbl">को सलाह दी गई है कि वह आराम/लाईट ड्यूटी के लिए</span>
          </div>

          <div class="row">
            <span class="lbl">He has been advised rest/light duty for&nbsp;</span>
            <span class="val" style="min-width:110px">${n.advised_days||"............"}</span>
            <span class="lbl">&nbsp;दोनो / Days</span>
          </div>

          <div class="row">
            <span class="lbl">से लागू w.e.f.:&nbsp;</span>
            <span class="val" style="flex:1">${r} to ${x}</span>
          </div>

          <div class="row">
            <span class="lbl">से वह बीमार as he/she is suffering from&nbsp;</span>
            <span class="val" style="flex:1; min-width:80px">${n.disease||"............"}</span>
            <span class="lbl">&nbsp;बीमारी (Disease)</span>
          </div>

          <div class="center-section">
            He is fit to join on &nbsp;<span class="val" style="min-width:150px; font-size:15pt">${f}</span>
          </div>

          ${m?`
          <div style="margin: 6mm 0 4mm; padding: 10px 16px; border: 2px solid #c62828; border-radius: 6px; background: rgba(198,40,40,0.04);">
            <div style="display: flex; align-items: flex-end; flex-wrap: nowrap; line-height: 2;">
              <span style="white-space: nowrap; font-size: 12pt; font-weight: 700; color: #c62828;">Rest further extended till / आराम आगे बढ़ाया गया:&nbsp;</span>
              <span class="val val-red" style="min-width:150px; font-size:15pt">${m}</span>
            </div>
          </div>
          `:""}

          <div class="footer">
            <div class="footer-date">${g}</div>
            <div class="footer-sign">
              <div class="sign-line"></div>
              चिकित्सा अधिकारी<br/>Medical Officer
            </div>
          </div>

          <div class="copyright">
            Designed, developed, and maintained by HMS IT Department © 2026. All rights reserved.
          </div>
        </div>
        <script>
          window.onload = function() { window.print(); window.onafterprint = function() { window.close(); }; };
        <\/script>
      </body>
      </html>
    `),h.document.close()};if(!n)return e.jsx("div",{style:{padding:40,textAlign:"center",fontSize:"1.1rem"},children:"Loading rest form..."});const{name:k,empNo:E,attendedDateStr:_,attendedTimeStr:T,fromDate:W,toDate:A,fitDate:R,extendedDate:u,formDate:$}=j(n,v);return e.jsxs("main",{style:{background:"#64748b",minHeight:"100vh"},children:[e.jsxs("div",{style:{display:"flex",gap:12,justifyContent:"center",padding:16,background:"#1e293b",borderBottom:"1px solid #334155",position:"sticky",top:0,zIndex:10},children:[e.jsx("h1",{className:"sr-only",children:"Rest form preview"}),e.jsxs("button",{type:"button",onClick:()=>c(-1),style:b("#334155","#e2e8f0","#475569"),children:[e.jsx(H,{size:16,"aria-hidden":"true"})," Back"]}),e.jsxs("button",{type:"button",onClick:()=>c(`/doctor/rest-forms/edit/${p}`),style:b("#334155","#e2e8f0","#475569"),children:[e.jsx(C,{size:16,"aria-hidden":"true"})," Edit"]}),e.jsxs("button",{type:"button",onClick:N,style:b("#005eb8","#fff","#005eb8"),children:[e.jsx(I,{size:16,"aria-hidden":"true"})," Print"]})]}),e.jsx("div",{style:{display:"flex",justifyContent:"center",padding:"30px 20px"},children:e.jsxs("div",{style:{width:"210mm",background:"#fff",padding:"12mm 18mm",boxShadow:"0 4px 25px rgba(0,0,0,0.25)",fontFamily:"'Noto Sans Devanagari', 'Times New Roman', serif",color:"#111",fontSize:"12pt",lineHeight:1.5},children:[e.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"center",position:"relative",marginBottom:"7mm",minHeight:130},children:[e.jsx("img",{src:"/logo.png",alt:"Logo",style:{position:"absolute",left:0,top:"50%",transform:"translateY(-50%)",width:130,height:130,objectFit:"contain"}}),e.jsxs("div",{style:{textAlign:"center",zIndex:1},children:[e.jsx("div",{style:{fontSize:"15pt",fontWeight:700},children:"अस्पताल प्रबंधन प्रणाली"}),e.jsx("div",{style:{fontSize:"15pt",fontWeight:700},children:"HOSPITAL MEDICAL CENTRE"}),e.jsx("div",{style:{fontSize:"12pt",fontWeight:600,marginTop:3},children:"चिकित्सा विभाग MEDICAL DEPARTMENT"}),e.jsx("div",{style:{fontSize:"12pt",fontWeight:600},children:"रेस्ट फार्म REST FORM"})]})]}),e.jsx("div",{style:{display:"flex",justifyContent:"flex-start",marginBottom:"6mm",fontSize:"11.5pt"},children:e.jsxs("div",{children:["Sr. No.  ",e.jsx("span",{style:{...S,minWidth:110},children:n.sr_no||"........"})]})}),e.jsxs("div",{style:o,children:[e.jsx("span",{style:i,children:"श्री / Shri. "}),e.jsx("span",{style:{...l,flex:1,minWidth:160},children:k}),e.jsx("span",{style:i,children:"  कार्यरत / working as "}),e.jsx("span",{style:{...l,minWidth:120},children:n.working_as||"............"}),e.jsx("span",{style:i,children:" में / in "}),e.jsx("span",{style:{...l,minWidth:120},children:n.department||"............"})]}),e.jsxs("div",{style:o,children:[e.jsx("span",{style:i,children:"अनुभाग व विभाग क्रम.स० (Section or Department) E. No.: "}),e.jsx("span",{style:{...l,flex:1},children:E||"............"})]}),e.jsxs("div",{style:o,children:[e.jsx("span",{style:i,children:"मुख्य अस्पताल/प्रा० स्वा० के०में उपस्थित हुआ attended Main Hospital/FAP on "}),e.jsx("span",{style:{...l,minWidth:130},children:_}),e.jsx("span",{style:i,children:" दिनांक / Date"})]}),e.jsxs("div",{style:o,children:[e.jsx("span",{style:i,children:"को / at "}),e.jsx("span",{style:{...l,minWidth:110},children:T}),e.jsx("span",{style:i,children:" ए.एम./पी.एम. a.m./p.m."})]}),e.jsx("div",{style:o,children:e.jsx("span",{style:i,children:"को सलाह दी गई है कि वह आराम/लाईट ड्यूटी के लिए"})}),e.jsxs("div",{style:o,children:[e.jsx("span",{style:i,children:"He has been advised rest/light duty for "}),e.jsx("span",{style:{...l,minWidth:110},children:n.advised_days||"............"}),e.jsx("span",{style:i,children:" दोनो / Days"})]}),e.jsxs("div",{style:o,children:[e.jsx("span",{style:i,children:"से लागू w.e.f.: "}),e.jsxs("span",{style:{...l,flex:1},children:[W," to ",A]})]}),e.jsxs("div",{style:o,children:[e.jsx("span",{style:i,children:"से वह बीमार as he/she is suffering from "}),e.jsx("span",{style:{...l,flex:1,minWidth:80},children:n.disease||"............"}),e.jsx("span",{style:i,children:" बीमारी (Disease)"})]}),e.jsxs("div",{style:{textAlign:"center",margin:"8mm 0",fontSize:"13.5pt",fontWeight:600},children:["He is fit to join on  ",e.jsx("span",{style:{...l,minWidth:150,fontSize:"15pt"},children:R})]}),u&&e.jsx("div",{style:{margin:"6mm 0 4mm",padding:"10px 16px",border:"2px solid #c62828",borderRadius:6,background:"rgba(198,40,40,0.04)"},children:e.jsxs("div",{style:o,children:[e.jsx("span",{style:{...i,fontWeight:700,color:"#c62828"},children:"Rest further extended till / आराम आगे बढ़ाया गया: "}),e.jsx("span",{style:{...S,minWidth:150,fontSize:"15pt"},children:u})]})}),e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginTop:"14mm"},children:[e.jsx("div",{style:{fontSize:"13pt",fontWeight:700,color:"#c62828"},children:$}),e.jsxs("div",{style:{textAlign:"center",fontSize:"11pt"},children:[e.jsx("div",{style:{width:170,borderBottom:"1.2px solid #333",marginBottom:5}}),"चिकित्सा अधिकारी",e.jsx("br",{}),"Medical Officer"]})]}),e.jsx("div",{style:{textAlign:"center",fontSize:"7.5pt",color:"#666",marginTop:"8mm"},children:"Designed, developed, and maintained by HMS IT Department © 2026. All rights reserved."})]})})]})}const o={display:"flex",alignItems:"flex-end",flexWrap:"nowrap",marginBottom:"5mm",lineHeight:2},i={whiteSpace:"nowrap",fontSize:"11.5pt"},l={color:"#1a237e",fontWeight:700,fontSize:"13pt",borderBottom:"1px dotted #555",padding:"0 6px",display:"inline-block",textAlign:"center",minWidth:40},S={color:"#c62828",fontWeight:800,fontSize:"16pt",borderBottom:"2px dotted #c62828",padding:"0 8px",display:"inline-block",textAlign:"center"},b=(p,c,n)=>({display:"inline-flex",alignItems:"center",gap:6,padding:"10px 22px",borderRadius:8,fontSize:"0.9rem",cursor:"pointer",fontWeight:600,border:`1px solid ${n}`,background:p,color:c});export{Y as default};
