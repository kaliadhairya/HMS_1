import { useState, useEffect, useMemo } from 'react';
import { CalendarDays, Plane } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

export default function DoctorSchedulePage() {
  const [schedule, setSchedule] = useState({ availability: [], leaves: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/doctor/schedule')
      .then(res => setSchedule(res.data.data || { availability: [], leaves: [] }))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const availability = schedule.availability || [];
  const leaves = schedule.leaves || [];

  const columns = useMemo(() => [
    { id: 'day', header: 'Day', accessorFn: (a) => a.day || '', meta: { width: 130 }, enableSorting: false, cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    { id: 'slots', header: 'Session timing', accessorFn: (a) => a.slots || '', enableSorting: false, cell: ({ getValue }) => <span className="tag tabular">{getValue()}</span> },
    {
      id: 'dates', header: 'Upcoming dates', accessorFn: (a) => (a.upcoming_dates || []).join(', '), enableSorting: false,
      cell: ({ getValue }) => <span className="cell-secondary tabular">{getValue() || '—'}</span>,
    },
    {
      id: 'max', header: 'Booked patients', accessorFn: (a) => Number(a.max_patients || 0), meta: { width: 150, align: 'right' },
      cell: ({ getValue }) => <span className="tabular" style={{ fontWeight: 600 }}>{getValue()}</span>,
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="My schedule"
          description="Your OPD sessions derived from upcoming appointments, and planned leave."
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          <section className="panel" style={{ flex: '2 1 520px', minWidth: 0 }}>
            <div className="panel-head">
              <h2 className="panel-title" style={{ margin: 0 }}><CalendarDays size={16} aria-hidden="true" /> OPD availability</h2>
              <button type="button" className="btn btn-ghost btn-sm" disabled title="Doctor self-service timing edits are not implemented in this build.">
                Timings are read-only
              </button>
            </div>
            <DataTable
              columns={columns}
              data={availability}
              loading={loading}
              getRowId={(a) => a.day}
              empty={(
                <EmptyState
                  icon={CalendarDays}
                  title="No schedule data"
                  description="No upcoming appointments are scheduled, so no availability pattern can be derived."
                />
              )}
            />
          </section>

          <section className="panel" style={{ flex: '1 1 280px', minWidth: 0 }}>
            <div className="panel-head">
              <h2 className="panel-title" style={{ margin: 0 }}><Plane size={16} aria-hidden="true" /> Upcoming leave</h2>
              <button type="button" className="btn btn-ghost btn-sm" disabled title="Leave application is handled from the admin attendance workflow.">
                Apply via admin
              </button>
            </div>
            <div className="panel-pad">
              {loading ? <p className="muted">Loading…</p> : leaves.length === 0 ? (
                <p className="muted">No upcoming leave scheduled.</p>
              ) : (
                <ul className="list-rows">
                  {leaves.map((l, idx) => (
                    <li key={idx} className="list-row" style={{ cursor: 'default' }}>
                      <span className="cell-stack">
                        <span className="cell-primary">{new Date(l.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                        <span className="cell-secondary">{l.reason}</span>
                      </span>
                      <span className={`status ${l.status === 'Approved' ? 'status-success' : 'status-warning'}`}>{l.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
