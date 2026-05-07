import { Upload } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../ui/dialog';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';

interface IImportProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importData: string;
  onImportDataChange: (value: string) => void;
  onImport: () => void;
}

export function ImportProjectDialog({
  open,
  onOpenChange,
  importData,
  onImportDataChange,
  onImport,
}: IImportProjectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="w-4 h-4 mr-2" />
          Import
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="import-data">Project JSON Data</Label>
            <Textarea
              id="import-data"
              placeholder="Paste your project JSON data here..."
              value={importData}
              onChange={(event) => onImportDataChange(event.target.value)}
              rows={10}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onImport}>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
