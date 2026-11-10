import React from 'react';
import { useNavigate } from 'react-router-dom';
import Glyph from './ui/Glyph';
import Modal from './ui/Modal';

export default function ReferralTypeModal({ isOpen, onClose, patient = null }) {
  const navigate = useNavigate();
  const select = (type) => {
    onClose();
    navigate('/doctor/referrals', { state: { type, autoSelectPatient: patient } });
  };
  return (
    <Modal open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} title="Select Referral Type" description="Where would you like to refer this patient?">
      <div className="referral-options">
        <button type="button" className="referral-option" onClick={() => select('Local')}>
          <Glyph icon="🏥" /> <span><strong>Local Referral</strong><small>Refer to another department within HMS Hospital</small></span>
        </button>
        <button type="button" className="referral-option" onClick={() => select('Outside')}>
          <Glyph icon="🚑" /> <span><strong>Outside Referral</strong><small>Refer to PGI, AIIMS, or other external hospitals</small></span>
        </button>
      </div>
    </Modal>
  );
}
