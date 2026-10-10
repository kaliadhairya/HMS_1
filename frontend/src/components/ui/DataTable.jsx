import { useState } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel, flexRender,
} from '@tanstack/react-table';
import { ArrowUp, ArrowDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react';

// Sortable, paginated table with loading skeleton, empty state and keyboard-accessible rows.
// Column `meta`: { align: 'right' | 'center', width: css width, className }.
export default function DataTable({
  columns, data, loading = false, onRowClick, getRowId, empty, pageSize = 25, initialSorting = [], rowLabel,
}) {
  const [sorting, setSorting] = useState(initialSorting);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const { pageIndex } = table.getState().pagination;
  const total = data.length;
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pageSize);
  const colCount = table.getVisibleLeafColumns().length;

  return (
    <div className="dt">
      <div className="dt-scroll">
        <table className="dt-table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta || {};
                  const sortable = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  const label = flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <th
                      key={header.id}
                      style={{ width: meta.width, textAlign: meta.align }}
                      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                    >
                      {sortable ? (
                        <button type="button" className={`dt-sort${dir ? ' is-sorted' : ''}`} onClick={header.column.getToggleSortingHandler()}>
                          {label}
                          {dir === 'asc' ? <ArrowUp size={13} /> : dir === 'desc' ? <ArrowDown size={13} /> : <ChevronsUpDown size={13} className="dt-sort-idle" />}
                        </button>
                      ) : label}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={`sk-${i}`} className="dt-skeleton-row" aria-hidden="true">
                {Array.from({ length: colCount }).map((__, j) => (
                  <td key={j}><span className="skeleton" style={{ width: `${45 + ((i * 7 + j * 13) % 45)}%` }} /></td>
                ))}
              </tr>
            ))}
            {!loading && total === 0 && (
              <tr><td colSpan={colCount} className="dt-empty-cell">{empty}</td></tr>
            )}
            {!loading && table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={onRowClick ? 'is-clickable' : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row.original); } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={onRowClick && rowLabel ? rowLabel(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta || {};
                  return (
                    <td key={cell.id} style={{ textAlign: meta.align }} className={meta.className}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && total > 0 && (
        <div className="dt-footer">
          <span className="dt-count">Showing <strong>{from}–{to}</strong> of <strong>{total}</strong></span>
          <div className="dt-pager">
            <button type="button" className="icon-btn" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
              <ChevronLeft size={16} />
            </button>
            <span>Page {pageIndex + 1} of {table.getPageCount()}</span>
            <button type="button" className="icon-btn" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
