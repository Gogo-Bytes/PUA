import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Paperclip } from 'lucide-react';
import { UIProvider, Button, Dialog } from '../../src/renderer/ui';
import { SelectRoot, SelectValue, SelectTrigger, SelectContent, SelectItem } from '../../src/renderer/ui/shadcn-select';
import { ComboboxRoot, ComboboxValue, ComboboxTrigger, ComboboxContent, ComboboxInput, ComboboxList, ComboboxItem, ComboboxEmpty } from '../../src/renderer/ui/shadcn-combobox';
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from '../../src/renderer/ui/shadcn-menu';
import '../../src/renderer/ui/tokens.css';
import '../../src/renderer/ui/ui.css';
import '../../src/renderer/ui/tailwind.css';

const models = ['均衡模型 · 本地示例', '快速模型 · 本地示例', '推理模型 · 长名称与窄窗测试'];
const levels = [{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }];
function Controls() {
  const host = useRef<HTMLDivElement>(null);
  const [model, setModel] = useState<string | null>(models[0]);
  const [level, setLevel] = useState<string | null>('medium');
  const [notice, setNotice] = useState('仅本地交互，不连接模型或文件选择器');
  return <div ref={host} className="shadcn-scope">
    <div className="tw:rounded-[20px] tw:border tw:border-solid tw:border-border tw:bg-popover tw:p-3 tw:shadow-sm">
      <textarea aria-label="预览输入框" placeholder="描述任务、粘贴内容或添加文件…" className="tw:min-h-24 tw:w-full tw:resize-y tw:p-1 tw:text-[15px] tw:leading-relaxed tw:outline-none tw:focus-visible:rounded-md tw:focus-visible:outline-2 tw:focus-visible:outline-ring"/>
      <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-1">
        <MenuRoot><MenuTrigger aria-label="添加"><Plus size={16}/></MenuTrigger><MenuContent container={host}><MenuItem onClick={() => setNotice('已触发添加附件 · 仅本地回调')}><Paperclip size={16}/>添加附件</MenuItem></MenuContent></MenuRoot>
        <ComboboxRoot items={models} value={model} onValueChange={setModel}>
          <ComboboxTrigger aria-label="模型"><ComboboxValue/></ComboboxTrigger>
          <ComboboxContent container={host}><ComboboxInput aria-label="搜索模型" placeholder="搜索模型…"/><ComboboxEmpty className="tw:p-2 tw:text-muted-foreground">没有匹配的模型</ComboboxEmpty><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent>
        </ComboboxRoot>
        <SelectRoot items={levels} value={level} onValueChange={setLevel}><SelectTrigger aria-label="思考程度">思考 · <SelectValue/></SelectTrigger><SelectContent container={host}>{levels.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></SelectRoot>
      </div>
    </div>
    <p role="status" className="tw:mt-3 tw:text-xs tw:text-muted-foreground">{notice}</p>
  </div>;
}
function Preview() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [dialog, setDialog] = useState(false);
  return <UIProvider theme={theme}><main className="shadcn-scope tw:min-h-screen tw:p-6">
    <div className="tw:mx-auto tw:max-w-2xl">
      <header className="tw:flex tw:flex-wrap tw:items-center tw:gap-3"><h1 className="tw:text-base tw:font-semibold">输入控件 · shadcn/ui + Base UI</h1><Button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>切换主题</Button><Button onClick={() => setDialog(true)}>Dialog 内测试</Button></header>
      <p className="tw:text-sm tw:text-muted-foreground">Tailwind 独立前缀 · 复用 PUA tokens · 已用于生产控件</p>
      <div className="tw:mt-40"><Controls/></div>
      <p className="tw:mt-8 tw:text-xs tw:text-muted-foreground">可测试搜索、方向键、Escape、焦点返回，以及缩窄窗口后的浮层位置。/ 和 @ 在主预览的 Composer 中验证。</p>
    </div>
    <Dialog open={dialog} onClose={() => setDialog(false)} title="Dialog 中的浮层"><Controls/></Dialog>
  </main></UIProvider>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Preview/></StrictMode>);
