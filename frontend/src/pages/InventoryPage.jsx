
import { useEffect, useState } from 'react';
import {
  ArrowDownUp,
  Boxes,
  CircleAlert,
  Clock3,
  History,
  RefreshCw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Pagination,
  SearchBox,
  Spinner,
  StatusPill,
  TableSkeleton,
} from '../components/UI';
import { getWorkspaceName } from '../workspaceName';
import {
  formatInventoryDate as displayDate,
  inventoryDateKey as dateKey,
  isInventoryDateExpired as isExpired,
} from '../inventoryDates';

// FIX: Define todayKey to prevent the Inventory page from crashing.
function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export default function InventoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pharmacies, setPharmacies] = useState([]);
  const [historyModal, setHistoryModal] = useState(null);

  const canAdjust = [
    'platform_admin',
    'pharmacy_manager',
    'inventory_clerk',
  ].includes(user?.role);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const response = await api(
        `/inventory?page=${page}&limit=15&search=${encodeURIComponent(query)}`
      );
      setResult(response);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(load, 180);
    return () => clearTimeout(timer);
  }, [page, query]);

  useEffect(() => {
    let active = true;

    api('/pharmacies')
      .then((response) => {
        if (active) {
          setPharmacies(response.data || []);
        }
      })
      .catch(() => {
        if (active) {
          setPharmacies([]);
        }
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  function startCount(row) {
    navigate('/reconciliation', {
      state: {
        pharmacyId: Number(row.pharmacyId),
        batchIds: [Number(row.batchId)],
        batchNumber: row.batchNumber,
        medicineName: row.medicineName,
      },
    });
  }

  async function openHistory(row) {
    setHistoryModal({
      row,
      loading: true,
      error: null,
      data: null,
    });

    try {
      const response = await api(`/inventory/${row.batchId}/history`);

      setHistoryModal({
        row,
        loading: false,
        error: null,
        data: response.data || [],
      });
    } catch (historyError) {
      setHistoryModal({
        row,
        loading: false,
        error: historyError,
        data: null,
      });
    }
  }

  const workspaceName =
    user?.role === 'platform_admin'
      ? 'All pharmacies'
      : getWorkspaceName(user, pharmacies);

  const pharmacyName = (pharmacyId) =>
    pharmacies.find(
      (pharmacy) => Number(pharmacy.id) === Number(pharmacyId)
    )?.name || `Pharmacy ${pharmacyId}`;

  return (
    <>
      <PageHeader
        eyebrow="STOCK CONTROL"
        title="Inventory"
        description="Review batch balances, stock risk and expiry in your authorized pharmacy scope."
        action={
          <button
            type="button"
            className="button button-secondary"
            onClick={load}
            disabled={loading}
            aria-busy={loading}
          >
            <RefreshCw
              size={15}
              className={loading ? 'subtle-spin' : ''}
            />
            {loading ? 'Refreshing' : 'Refresh stock'}
          </button>
        }
      />

      <div className="inventory-scope-banner">
        <span className="inventory-scope-icon">
          <Boxes size={17} />
        </span>

        <span>
          <small>INVENTORY SCOPE</small>
          <b>{workspaceName}</b>
        </span>

        <span className="inventory-scope-caption">
          Pharmacy access enforced by your account
        </span>
      </div>

      <section className="panel table-panel inventory-panel">
        <div className="table-toolbar inventory-toolbar">
          <div>
            <span className="eyebrow">BATCH-LEVEL STOCK</span>
            <h2>Stock on hand</h2>

            <p>
              {result
                ? `${result.pagination.total} batch records in this scope`
                : 'Balances are shown by medicine batch and location.'}
            </p>
          </div>

          <SearchBox
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
            placeholder="Search medicine or batch..."
          />
        </div>

        {loading ? (
          <TableSkeleton rows={7} cols={6} />
        ) : error ? (
          <ErrorState error={error} retry={load} />
        ) : result?.data?.length ? (
          <>
            <div className="data-table-wrap inventory-table-wrap">
              <table className="data-table inventory-table">
                <thead>
                  <tr>
                    <th>MEDICINE & BATCH</th>
                    <th>PHARMACY</th>
                    <th>ON HAND</th>
                    <th>REORDER POINT</th>
                    <th>EXPIRY</th>
                    <th>SAFETY</th>
                    <th>
                      <span className="sr-only">Batch actions</span>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {result.data.map((row) => {
                    const expired = isExpired(row.expiryDate);
                    const low = Boolean(row.isLowStock);
                    const recalled = Boolean(row.isRecalled);

                    return (
                      <tr key={row.id}>
                        <td>
                          <div className="inventory-product-cell">
                            <span className="medicine-mark">
                              <Boxes size={16} />
                            </span>

                            <span className="stacked-cell">
                              <b>
                                {row.medicineName} {row.strength}
                              </b>

                              <small>
                                {row.batchNumber}
                                {row.supplierName
                                  ? ` · ${row.supplierName}`
                                  : ''}
                              </small>
                            </span>
                          </div>
                        </td>

                        <td>
                          <span
                            className="inventory-location"
                            title={pharmacyName(row.pharmacyId)}
                          >
                            {pharmacyName(row.pharmacyId)}
                          </span>
                        </td>

                        <td>
                          <div className="inventory-quantity-cell">
                            <strong
                              className={low ? 'quantity-low' : ''}
                            >
                              {Number(
                                row.quantityOnHand
                              ).toLocaleString('en-IN')}
                            </strong>

                            <span>units</span>

                            {low && (
                              <StatusPill tone="warning">
                                Low
                              </StatusPill>
                            )}
                          </div>
                        </td>

                        <td>
                          {Number(row.reorderLevel).toLocaleString(
                            'en-IN'
                          )}{' '}
                          <span className="muted">units</span>
                        </td>

                        <td>
                          <div className="inventory-expiry-cell">
                            <b className={expired ? 'expiry-past' : ''}>
                              {displayDate(row.expiryDate)}
                            </b>

                            <small>
                              {expired
                                ? 'Past expiry'
                                : dateKey(row.expiryDate) === todayKey()
                                ? 'Expires today'
                                : 'FEFO allocation date'}
                            </small>
                          </div>
                        </td>

                        <td>
                          <div className="pill-stack">
                            {recalled && (
                              <StatusPill tone="danger">
                                Recall
                              </StatusPill>
                            )}

                            {expired && (
                              <StatusPill tone="danger">
                                Expired
                              </StatusPill>
                            )}

                            {!recalled && !expired && (
                              <StatusPill tone="good">
                                In date
                              </StatusPill>
                            )}
                          </div>
                        </td>

                        <td>
                          <div className="inventory-row-actions">
                            <button
                              type="button"
                              className="button button-small button-secondary"
                              onClick={() => openHistory(row)}
                              aria-label={`View stock history for ${row.medicineName}, batch ${row.batchNumber}`}
                            >
                              <History size={14} />
                              <span>History</span>
                            </button>

                            {canAdjust && (
                              <button
                                type="button"
                                className="button button-small button-primary"
                                onClick={() => startCount(row)}
                                aria-label={`Start physical count for ${row.medicineName}, batch ${row.batchNumber}`}
                              >
                                <ArrowDownUp size={14} />
                                <span>Count</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              page={result.pagination.page}
              pages={result.pagination.pages}
              onChange={setPage}
            />
          </>
        ) : (
          <EmptyState
            icon={Boxes}
            title="No inventory batches found"
            text={
              query
                ? 'Try another medicine or batch number.'
                : 'Inventory appears after a batch is received into a pharmacy.'
            }
          />
        )}
      </section>

      <div className="inventory-hint">
        <CircleAlert size={17} />

        <span>
          Physical corrections use reconciliation and independent
          manager approval. Sales and transfers continue through
          their dedicated stock workflows.
        </span>
      </div>

      {historyModal && (
        <Modal
          title={`Batch history · ${historyModal.row.batchNumber}`}
          onClose={() => setHistoryModal(null)}
          wide
        >
          <div className="batch-detail-summary">
            <div>
              <span>MEDICINE</span>
              <b>
                {historyModal.row.medicineName}{' '}
                {historyModal.row.strength}
              </b>
            </div>

            <div>
              <span>PHARMACY</span>
              <b>{pharmacyName(historyModal.row.pharmacyId)}</b>
            </div>

            <div>
              <span>CURRENT BALANCE</span>
              <b>
                {Number(
                  historyModal.row.quantityOnHand
                ).toLocaleString('en-IN')}{' '}
                units
              </b>
            </div>

            <div>
              <span>REORDER POINT</span>
              <b>
                {Number(
                  historyModal.row.reorderLevel
                ).toLocaleString('en-IN')}{' '}
                units
              </b>
            </div>

            <div>
              <span>EXPIRY</span>
              <b>{displayDate(historyModal.row.expiryDate)}</b>
            </div>
          </div>

          {historyModal.loading ? (
            <Spinner label="Loading batch movement history" />
          ) : historyModal.error ? (
            <ErrorState
              error={historyModal.error}
              retry={() => openHistory(historyModal.row)}
            />
          ) : historyModal.data?.length ? (
            <div className="data-table-wrap batch-history-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>MOVEMENT</th>
                    <th>CHANGE</th>
                    <th>BALANCE AFTER</th>
                    <th>RECORDED BY</th>
                    <th>TIME</th>
                    <th>REASON</th>
                  </tr>
                </thead>

                <tbody>
                  {historyModal.data.map((movement) => (
                    <tr key={movement.id}>
                      <td>
                        <StatusPill
                          tone={
                            movement.movementType === 'adjustment'
                              ? 'warning'
                              : 'neutral'
                          }
                        >
                          {movement.movementType.replaceAll('_', ' ')}
                        </StatusPill>
                      </td>

                      <td
                        className={
                          Number(movement.quantityDelta) < 0
                            ? 'quantity-low'
                            : ''
                        }
                      >
                        {Number(movement.quantityDelta) > 0
                          ? '+'
                          : ''}
                        {Number(
                          movement.quantityDelta
                        ).toLocaleString('en-IN')}
                      </td>

                      <td>
                        {Number(
                          movement.quantityAfter
                        ).toLocaleString('en-IN')}
                      </td>

                      <td>{movement.userName || 'System'}</td>

                      <td>
                        {new Date(
                          movement.createdAt
                        ).toLocaleString('en-IN', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </td>

                      <td>{movement.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Clock3}
              title="No movement history recorded"
              text="This response contains no stock-history rows for the selected batch."
            />
          )}
        </Modal>
      )}
    </>
  );
}
