import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import api from '../api/axios';
export default function ReportPage(){
 const {reportId}=useParams(),[params]=useSearchParams(),[report,setReport]=useState(null),[error,setError]=useState('');
 useEffect(()=>{if(reportId==='new')return;api.get('/reports/'+reportId).then(r=>setReport(r.data.report)).catch(e=>setError(e.response?.data?.message||'Historical report unavailable.'));},[reportId]);
 const patient=report?.patientId||report?.patient_id||params.get('patient_id');
 return <><Navbar/><main className="app-page"><h1>Historical laboratory report</h1><p>Read-only historical evidence. New results and corrections require the accession, technical-review and authorized-release workflow.</p><Link className="btn btn-primary" to={'/lab/governed'+(patient?'?patient_id='+patient:'')}>Open laboratory workflow</Link>{error&&<p role="alert">{error}</p>}{report&&<><h2>{report.patient?.name||'Historical patient record'}</h2>{['haematology','biochemistry','serology','urine','other'].map(section=><section key={section}><h3>{section}</h3><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(report[section],null,2)}</pre></section>)}<p>{report.remarks}</p><a href={'/api/reports/'+reportId+'/pdf'} target="_blank" rel="noreferrer">Download historical PDF</a></>}</main></>;
}
