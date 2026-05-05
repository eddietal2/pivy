import React from 'react';
import CollapsibleSection from '@/components/ui/CollapsibleSection';
import { AlertTriangle, FileText, Cpu, ShieldAlert } from 'lucide-react';
import { DisclaimersSkeleton } from '@/components/ui/skeletons';

interface Props {
  isLoading: boolean;
  setStopLossModalOpen: (open: boolean) => void;
  setDisclaimerModalOpen: (open: boolean) => void;
  setAiUsageModalOpen: (open: boolean) => void;
}

export default function DisclaimersSection({ isLoading, setStopLossModalOpen, setDisclaimerModalOpen, setAiUsageModalOpen }: Props) {
  if (isLoading) return <DisclaimersSkeleton />;

  return (
    <CollapsibleSection
      title={
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-amber-500" />
          <span className="text-xl font-bold text-gray-900 dark:text-white">Legal & Risk</span>
        </div>
      }
      defaultOpen={false}
      borderBottom={false}
      openKey={'disclaimers'}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm dark:shadow-lg border border-gray-200 dark:border-gray-700">
        <div className="grid grid-cols-1 gap-3">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex justify-between items-start gap-3 item-press">
          <div className="item-press-inner relative flex-1">
            <strong className="block flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-400" />Stop Loss Reminder</strong>
            <p className="text-sm text-gray-600 dark:text-gray-300">A stop loss is used to limit an investor's loss on a position. Set one to help protect capital and manage risk.</p>
          </div>
          <div className="flex-shrink-0">
            <button className="px-3 py-1 rounded bg-indigo-600 text-white text-sm hover:bg-red-700" aria-label="Open stop loss details" onClick={() => setStopLossModalOpen(true)}>Learn more</button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex justify-between items-start gap-3 item-press">
          <div className="item-press-inner relative flex-1">
            <strong className="block flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-300" />Legal Disclaimer</strong>
            <p className="text-sm text-gray-600 dark:text-gray-300">This data is for informational/testing purposes only and does not constitute financial advice.</p>
          </div>
          <div className="flex-shrink-0">
            <button className="px-3 py-1 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700" aria-label="Open disclaimer details" onClick={() => setDisclaimerModalOpen(true)}>Learn more</button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex justify-between items-start gap-3 item-press">
          <div className="item-press-inner relative flex-1">
            <strong className="block flex items-center gap-2"><Cpu className="w-4 h-4 text-gray-600" />AI Usage</strong>
            <p className="text-sm text-gray-600 dark:text-gray-300">This app uses language models (LLMs) to summarize market data and provide context for signals. Learn more about how this works and the model limitations.</p>
          </div>
          <div className="flex-shrink-0">
            <button data-testid="ai-usage-open-btn" className="px-3 py-1 rounded bg-indigo-600 text-white text-sm hover:bg-gray-900" aria-label="Open AI usage details" onClick={() => setAiUsageModalOpen(true)}>Learn more</button>
          </div>
        </div>
        </div>
      </div>
    </CollapsibleSection>
  );
}
