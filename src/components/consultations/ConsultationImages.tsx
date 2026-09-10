import {useEffect, useRef, useState, type ChangeEvent} from 'react';
import {useAuth} from '@clerk/react';
import {Button} from '@heroui/react';
import {Picture, Xmark} from '@gravity-ui/icons';
import {useMutation} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import type {Id} from '../../../convex/_generated/dataModel';
import {commentImageTypes as acceptedTypes, commentImageLimit, ImageUploadError, uploadCommentImage} from '../comments/comment-image-upload';
import styles from './ConsultationsPanel.module.css';

type DraftImage = {key: string; file: File; preview: string; imageId?: Id<'commentImages'>; status: 'selected' | 'uploading' | 'ready' | 'failed'};

export function useConsultationImages() {
  const {getToken} = useAuth();
  const discard = useMutation(api.commentImages.discard);
  const [items, setItems] = useState<DraftImage[]>([]);
  const [error, setError] = useState('');
  const current = useRef(items);
  const controller = useRef<AbortController | null>(null);
  const discardRef = useRef(discard);
  discardRef.current = discard;

  function update(next: DraftImage[]) { current.current = next; setItems(next); }
  function release(item: DraftImage, discardFile = true) {
    URL.revokeObjectURL(item.preview);
    if (discardFile && item.imageId) void discardRef.current({imageId: item.imageId}).catch(() => {});
  }
  useEffect(() => () => {
    controller.current?.abort();
    current.current.forEach(item => release(item));
    current.current = [];
  }, []);

  function add(files: File[]) {
    if (controller.current) return;
    if (current.current.length + files.length > 4) { setError('每条消息最多添加 4 张图片。'); return; }
    if (files.some(file => !acceptedTypes.includes(file.type))) { setError('请选择 JPEG、PNG、WebP 或 GIF 图片。'); return; }
    if (files.some(file => !file.size || file.size > commentImageLimit)) { setError('每张图片须大于 0 字节且不超过 5 MB。'); return; }
    setError('');
    update([...current.current, ...files.map(file => ({key: crypto.randomUUID(), file, preview: URL.createObjectURL(file), status: 'selected' as const}))]);
  }
  function remove(key: string) {
    if (controller.current) return;
    const item = current.current.find(item => item.key === key);
    if (item) release(item);
    update(current.current.filter(item => item.key !== key));
    setError('');
  }
  async function upload() {
    if (controller.current) throw new Error('图片正在上传，请稍候。');
    const request = new AbortController();
    controller.current = request;
    setError('');
    try {
      for (const item of [...current.current]) {
        if (item.imageId) continue;
        update(current.current.map(image => image.key === item.key ? {...image, status: 'uploading'} : image));
        try {
          const imageId = await uploadCommentImage(item.file, getToken, {purpose: 'consultation', signal: request.signal});
          if (request.signal.aborted) {
            void discardRef.current({imageId}).catch(() => {});
            throw new ImageUploadError('ABORTED');
          }
          update(current.current.map(image => image.key === item.key ? {...image, imageId, status: 'ready'} : image));
        } catch (failure) {
          const uploadError = failure instanceof ImageUploadError ? failure : new ImageUploadError('UPLOAD_FAILED');
          if (!request.signal.aborted) {
            update(current.current.map(image => image.key === item.key ? {...image, status: 'failed'} : image));
            setError(`${uploadError.message}文字与图片预览已保留。`);
          }
          throw uploadError;
        }
      }
      return current.current.map(item => item.imageId!);
    } finally { if (controller.current === request) controller.current = null; }
  }
  function commit() {
    current.current.forEach(item => release(item, false));
    update([]); setError('');
  }
  return {items, error, add, remove, upload, commit};
}

export function ConsultationImagePicker({draft, disabled}: {draft: ReturnType<typeof useConsultationImages>; disabled: boolean}) {
  const input = useRef<HTMLInputElement>(null);
  function select(event: ChangeEvent<HTMLInputElement>) {
    draft.add(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = '';
  }
  return <div className={styles.attachments}>
    <div className={styles.attachmentTools}>
      <Button size="sm" variant="ghost" isDisabled={disabled || draft.items.length >= 4} onPress={() => input.current?.click()}><Picture width={16} height={16} aria-hidden="true" />添加图片</Button>
      <span className={styles.note}>最多 4 张，每张 5 MB</span>
      <input ref={input} type="file" accept={acceptedTypes.join(',')} multiple hidden aria-label="选择咨询图片" onChange={select} disabled={disabled} />
    </div>
    {draft.items.length > 0 && <ul className={styles.attachmentDrafts} aria-label="待发送的咨询图片">
      {draft.items.map((item, index) => <li key={item.key} data-status={item.status}>
        <img src={item.preview} alt={`待发送图片 ${index + 1}`} />
        <Button size="sm" variant="secondary" isIconOnly className={styles.removeImage} aria-label={`移除图片 ${index + 1}`} isDisabled={disabled} onPress={() => draft.remove(item.key)}><Xmark width={14} height={14} aria-hidden="true" /></Button>
        {item.status === 'uploading' || item.status === 'failed' ? <span className={styles.uploadStatus} role="status">{item.status === 'uploading' ? '上传中…' : '上传失败'}</span> : null}
      </li>)}
    </ul>}
    {draft.error && <p className={styles.error} role="alert">{draft.error}</p>}
  </div>;
}
