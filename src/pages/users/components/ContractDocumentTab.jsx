import { ContractTab } from '../../profile/components/ContractTab';

const ContractDocumentsTab = ({ userId }) => {
  return (
    <div className="space-y-6">
      {/* New Contracts Section (Managed by Managers) */}
      <ContractTab userId={userId} allowUpload={true} />
    </div>
  );
};

export default ContractDocumentsTab;