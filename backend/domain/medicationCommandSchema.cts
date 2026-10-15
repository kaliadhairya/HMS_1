const contentFields=['product_id','ingredient_id','dose','dose_unit','route','frequency','starts_at','ends_at','prn','indication','max_dose','max_period_hours','min_interval_minutes','supply_quantity','supply_unit'] as const;
const createFields=['patient_id','encounter_id','admission_id',...contentFields] as const;
const dispenseFields=['order_id','order_version_id','product_id','location_id','quantity','witness_id','reason'] as const;
const administrationFields=['schedule_id','order_version_id','patient_id','product_id','dispense_line_id','dose','dose_unit','route','scan_evidence','outcome','actual_at','reason','witness_id','late_review_id'] as const;
module.exports={contentFields,createFields,dispenseFields,administrationFields};
