import {useState} from 'react';
import {Button, Modal} from '@heroui/react';
import type {Id} from '../../../convex/_generated/dataModel';
import surface from '../demos/DemoSurface.module.css';
import useAuthenticatedImage from './useAuthenticatedImage';
import './comment-images.css';

export interface CommentImage {id: Id<'commentImages'>; url: string; contentType: string; size: number}

function ImagePreview({image, index, label}: {image: CommentImage; index: number; label: string}) {
  const {source, failed, retry} = useAuthenticatedImage(image.url);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  return <div className="blog-comments__image" ref={setPortalContainer}>
    {source ? <Modal>
      <Button className="blog-comments__image-trigger" variant="ghost" aria-label={`查看图片 ${index + 1}`}>
        <img src={source} alt={`${label} ${index + 1}`} loading="lazy" decoding="async" />
      </Button>
      <Modal.Backdrop className={`${surface.surface} blog-comments__image-backdrop`} data-blog-image-modal UNSTABLE_portalContainer={portalContainer ?? undefined}>
        <Modal.Container size="lg" placement="center">
          <Modal.Dialog className="blog-comments__image-dialog" aria-label={label}>
            <Modal.CloseTrigger aria-label="关闭图片" />
            <Modal.Body><img className="blog-comments__image-full" src={source} alt={`${label} ${index + 1}`} /></Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal> : <div className="blog-comments__image-placeholder">
      <span role={failed ? 'alert' : 'status'}>{failed ? '图片暂时无法加载' : '正在加载图片…'}</span>
      {failed && <Button size="sm" variant="ghost" onPress={retry}>重新加载图片</Button>}
    </div>}
  </div>;
}

export default function CommentImages({images, label = '评论图片'}: {images: CommentImage[]; label?: string}) {
  if (!images.length) return null;
  return <div className="blog-comments__images" data-single-image={images.length === 1 || undefined}>
    {images.map((image, index) => <ImagePreview key={image.id} image={image} index={index} label={label} />)}
  </div>;
}
