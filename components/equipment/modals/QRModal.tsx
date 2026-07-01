"use client";

import QRCodeModal from "@/components/QRCodeModal";
import { useEquipment } from "../EquipmentContext";

export default function QRModal() {
  const { showQRModal, qrEquipment, setShowQRModal, setQREquipment, isDark } = useEquipment();

  if (!(showQRModal && qrEquipment)) return null;

  return (
    <QRCodeModal
      isOpen={showQRModal}
      onClose={() => {
        setShowQRModal(false);
        setQREquipment(null);
      }}
      equipmentType={qrEquipment.type}
      equipmentId={qrEquipment.id}
      equipmentNumber={qrEquipment.number}
      locationName={qrEquipment.locationName}
      isDark={isDark}
    />
  );
}
