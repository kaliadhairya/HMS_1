-- 0013: scheduling without double-booking (blueprint 3.3: Schedule,
-- ResourceReservation, Appointment; 3.8: "Book/reschedule").
--
-- An appointment's time is stored as a range (slot_range) derived from its
-- date and slot times. An exclusion constraint refuses two live appointments
-- whose ranges overlap for the same doctor, so races and overlapping
-- reschedules cannot double-book, whatever code path writes the row.
-- Cancelled and no-show appointments release their time.
-- Capacity is one per doctor until a schedule policy says otherwise.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE hms_appointments ADD COLUMN slot_range tsrange;

-- Derived from the date and slot times; plain timestamps, so immutable and
-- independent of time zone settings (clinic times are facility-local).
CREATE FUNCTION appointment_slot_range() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  start_t TIME;
  end_t TIME;
BEGIN
  IF NEW.slot_start IS NULL OR NEW.slot_start !~ '^\d{2}:\d{2}$' THEN
    NEW.slot_range := NULL;
    RETURN NEW;
  END IF;
  start_t := NEW.slot_start::time;
  end_t := COALESCE(NULLIF(NEW.slot_end, ''), NEW.slot_start)::time;
  IF end_t <= start_t THEN
    RAISE EXCEPTION 'appointment must end after it starts' USING ERRCODE = 'check_violation';
  END IF;
  NEW.slot_range := tsrange(NEW.appointment_date + start_t, NEW.appointment_date + end_t, '[)');
  RETURN NEW;
END $$;

CREATE TRIGGER trg_appointment_slot_range BEFORE INSERT OR UPDATE OF appointment_date, slot_start, slot_end ON hms_appointments
  FOR EACH ROW EXECUTE FUNCTION appointment_slot_range();

-- Fill existing rows through the same trigger logic.
UPDATE hms_appointments SET slot_start = slot_start WHERE slot_range IS NULL;

-- Existing double-bookings (found in the live data: the same slot booked
-- twice for one doctor) cannot satisfy the constraint. The earliest booking
-- of each overlapping group keeps its slot. Each later one is cancelled, with
-- the reason recorded, and its row is kept for staff to rebook. Nothing is
-- deleted and no patient is moved to a different slot automatically.
CREATE TEMP TABLE double_booked ON COMMIT DROP AS
SELECT DISTINCT b.id
  FROM hms_appointments a
  JOIN hms_appointments b ON a.doctor_id = b.doctor_id AND a.id < b.id
   AND a.slot_range && b.slot_range
 WHERE (a.status IS NULL OR a.status NOT IN ('Cancelled', 'No Show'))
   AND (b.status IS NULL OR b.status NOT IN ('Cancelled', 'No Show'));

UPDATE hms_appointments SET status = 'Cancelled',
       cancellation_reason = 'Double-booked before the scheduling rule (migration 0013): rebook this patient'
 WHERE id IN (SELECT id FROM double_booked);

INSERT INTO quarantine.log (table_name, rows_moved, reason)
SELECT 'hms_appointments', count(*), 'double-booked slot: later booking cancelled, row kept for rebooking'
  FROM double_booked
 HAVING count(*) > 0;

ALTER TABLE hms_appointments ADD CONSTRAINT ex_appointments_doctor_no_overlap
  EXCLUDE USING gist (doctor_id WITH =, slot_range WITH &&)
  WHERE (status IS NULL OR status NOT IN ('Cancelled', 'No Show'));

CREATE INDEX ix_appointments_doctor_day ON hms_appointments (doctor_id, appointment_date);
