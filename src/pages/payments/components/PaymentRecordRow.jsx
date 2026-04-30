import React from 'react';
import Badge from '../../../components/ui/Badge';

const PaymentRecordRow = ({ record }) => {
  const getStatusVariant = (status) => {
    switch (status) {
      case 'Active': return 'success';
      case 'Pending': return 'warning';
      case 'Deactivated': return 'danger';
      default: return 'info';
    }
  };

  return (
     <div className="flex justify-between items-center p-2xl border border-border-accent-purple rounded-sm text-center">
      <span className="w-[160px] text-text-primary font-normal text-md truncate">{record.company}</span>
      <span className="w-[100px] text-text-primary font-normal text-base">{record.amount}</span>
      <span className="w-[120px] text-text-primary font-normal text-base">{record.method}</span>
      <span className="w-[100px] text-text-primary font-normal text-base">{record.type}</span>
      <span className="w-[100px] text-text-primary font-normal text-md">{record.dueDate}</span>
      <span className="w-[100px] text-text-primary font-normal text-md">{record.paidDate}</span>
      <div className="w-[100px] flex justify-center">
        <Badge variant={getStatusVariant(record.status)}>{record.status}</Badge>
      </div>
    </div>
  );
};

export default PaymentRecordRow;