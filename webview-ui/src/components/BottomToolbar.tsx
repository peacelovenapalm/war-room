import { useEffect, useRef, useState } from 'react';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { isBrowserRuntime } from '../runtime.js';
import { transport } from '../transport/index.js';
import { SoundToggle } from './SoundToggle.js';
import { Button } from './ui/Button.js';
import { ControlTooltip } from './ui/ControlTooltip.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onOpenClaude: () => void;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  workspaceFolders: WorkspaceFolder[];
  isBriefingOpen: boolean;
  onToggleBriefing: () => void;
  isShiftOpen: boolean;
  onToggleShift: () => void;
  isUnlocksOpen: boolean;
  onToggleUnlocks: () => void;
  isEmployeesOpen: boolean;
  onToggleEmployees: () => void;
  isHelpOpen: boolean;
  onToggleHelp: () => void;
  isCallOpen: boolean;
  onToggleCall: () => void;
  isChainsOpen: boolean;
  onToggleChains: () => void;
  isStandingOrdersOpen: boolean;
  onToggleStandingOrders: () => void;
  isContractsOpen: boolean;
  onToggleContracts: () => void;
}

export function BottomToolbar({
  isEditMode,
  onOpenClaude,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  workspaceFolders,
  isBriefingOpen,
  onToggleBriefing,
  isShiftOpen,
  onToggleShift,
  isUnlocksOpen,
  onToggleUnlocks,
  isEmployeesOpen,
  onToggleEmployees,
  isHelpOpen,
  onToggleHelp,
  isCallOpen,
  onToggleCall,
  isChainsOpen,
  onToggleChains,
  isStandingOrdersOpen,
  onToggleStandingOrders,
  isContractsOpen,
  onToggleContracts,
}: BottomToolbarProps) {
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [isBypassMenuOpen, setIsBypassMenuOpen] = useState(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);
  const pendingBypassRef = useRef(false);
  // Close folder picker / bypass menu on outside click
  useEffect(() => {
    if (!isFolderPickerOpen && !isBypassMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node)) {
        setIsFolderPickerOpen(false);
        setIsBypassMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isFolderPickerOpen, isBypassMenuOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;

  const handleAgentClick = () => {
    setIsBypassMenuOpen(false);
    pendingBypassRef.current = false;
    if (hasMultipleFolders) {
      setIsFolderPickerOpen((v) => !v);
    } else {
      onOpenClaude();
    }
  };

  const handleAgentHover = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(true);
    }
  };

  const handleAgentLeave = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(false);
    }
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    const bypassPermissions = pendingBypassRef.current;
    pendingBypassRef.current = false;
    transport.send({ type: 'launchAgent', folderPath: folder.path, bypassPermissions });
  };

  const handleBypassSelect = (bypassPermissions: boolean) => {
    setIsBypassMenuOpen(false);
    if (hasMultipleFolders) {
      pendingBypassRef.current = bypassPermissions;
      setIsFolderPickerOpen(true);
    } else {
      transport.send({ type: 'launchAgent', bypassPermissions });
    }
  };

  return (
    // Mobile (<640px, G6 BUILD-PLAN §G6 task 4): too many buttons to fit a
    // 390px viewport even at the 44px touch floor — becomes a horizontally
    // scrollable strip instead of reflowing into a new component family.
    // Position (which edge, which corner) is owned by the bottom-left
    // HudStack this mounts into (see hudLayout.ts); only the internal
    // width-cap + scroll behavior lives here.
    <div
      className="flex items-center gap-4 pixel-panel p-4
        max-sm:max-w-[calc(100vw-32px)] max-sm:overflow-x-auto max-sm:[&>*]:shrink-0"
      data-testid="bottom-toolbar"
    >
      {/* Hide + Agent in standalone browser mode (no terminal to interact with) */}
      {!isBrowserRuntime && (
        <div
          ref={folderPickerRef}
          className="relative"
          onMouseEnter={handleAgentHover}
          onMouseLeave={handleAgentLeave}
        >
          <Button
            variant="accent"
            onClick={handleAgentClick}
            className={
              isFolderPickerOpen || isBypassMenuOpen
                ? 'bg-accent-bright'
                : 'bg-accent hover:bg-accent-bright'
            }
          >
            + Agent
          </Button>
          <Dropdown isOpen={isBypassMenuOpen}>
            <DropdownItem onClick={() => handleBypassSelect(true)}>
              Skip permissions mode <span className="text-2xs text-warning">⚠</span>
            </DropdownItem>
          </Dropdown>
          <Dropdown isOpen={isFolderPickerOpen} className="min-w-128">
            {workspaceFolders.map((folder) => (
              <DropdownItem
                key={folder.path}
                onClick={() => handleFolderSelect(folder)}
                className="text-base"
              >
                {folder.name}
              </DropdownItem>
            ))}
          </Dropdown>
        </div>
      )}
      <ControlTooltip label="Edit office layout" side="top">
        <Button variant={isEditMode ? 'active' : 'default'} onClick={onToggleEditMode}>
          Layout
        </Button>
      </ControlTooltip>
      <Button
        variant={isBriefingOpen ? 'active' : 'default'}
        onClick={onToggleBriefing}
        title="Today's briefing"
      >
        Briefing
      </Button>
      <Button
        variant={isShiftOpen ? 'active' : 'default'}
        onClick={onToggleShift}
        title="Today's shift report"
      >
        Shift
      </Button>
      <Button
        variant={isUnlocksOpen ? 'active' : 'default'}
        onClick={onToggleUnlocks}
        title="Office decor unlocks"
      >
        Unlocks
      </Button>
      <Button
        variant={isEmployeesOpen ? 'active' : 'default'}
        onClick={onToggleEmployees}
        title="Employee roster"
      >
        Employees
      </Button>
      <ControlTooltip label="Call a coworker" side="top">
        <Button variant={isCallOpen ? 'active' : 'default'} onClick={onToggleCall}>
          Call
        </Button>
      </ControlTooltip>
      <ControlTooltip label="Build and dispatch multi-step chains" side="top">
        <Button variant={isChainsOpen ? 'active' : 'default'} onClick={onToggleChains}>
          Chains
        </Button>
      </ControlTooltip>
      <ControlTooltip label="Standing orders — chains that fire automatically" side="top">
        <Button
          variant={isStandingOrdersOpen ? 'active' : 'default'}
          onClick={onToggleStandingOrders}
        >
          Orders
        </Button>
      </ControlTooltip>
      <Button
        variant={isContractsOpen ? 'active' : 'default'}
        onClick={onToggleContracts}
        title="Contracts"
      >
        Contracts
      </Button>
      <ControlTooltip label="Settings" side="top">
        <Button variant={isSettingsOpen ? 'active' : 'default'} onClick={onToggleSettings}>
          Settings
        </Button>
      </ControlTooltip>
      {/* Word button, not icon-only (colorblind/help hard rule); ? also opens it */}
      <ControlTooltip label="Help (press ?)" side="top">
        <Button variant={isHelpOpen ? 'active' : 'default'} onClick={onToggleHelp}>
          Help
        </Button>
      </ControlTooltip>
      <SoundToggle />
    </div>
  );
}
