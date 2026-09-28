import {forwardRef, useImperativeHandle, useMemo, useRef} from 'react';
import {Bold, Code, CurlyBrackets, Italic, Link, ListOl, ListUl, QuoteOpen} from '@gravity-ui/icons';
import {Avatar, Tooltip} from '@heroui/react';
import {RichTextEditor} from '@heroui-pro/react/rich-text-editor';
import {Markdown} from '@tiptap/markdown';
import type {Editor, JSONContent} from '@tiptap/core';
import {COMMENT_BODY_MAX_LENGTH, isCommentBodyOverLimit} from './comment-markdown';

const EMPTY_DOC: JSONContent = {type: 'doc', content: [{type: 'paragraph'}]};

export interface CommentComposerHandle {
  focus: () => void;
}

interface CommentComposerProps {
  resetKey: number;
  body: string;
  onChange: (body: string) => void;
  authorName: string;
  authorImageUrl?: string;
  isDisabled?: boolean;
  placeholder?: string;
}

function serializeBody(editor: Editor) {
  return (editor.getMarkdown?.() ?? editor.getText()).trimEnd();
}

const CommentComposer = forwardRef<CommentComposerHandle, CommentComposerProps>(function CommentComposer(
  {resetKey, body, onChange, authorName, authorImageUrl, isDisabled = false, placeholder = '写下你的想法…'},
  ref,
) {
  const editorRef = useRef<Editor | null>(null);
  const markdownExtension = useMemo(() => [Markdown], []);
  const overLimit = isCommentBodyOverLimit(body);

  useImperativeHandle(ref, () => ({
    focus: () => {
      editorRef.current?.commands.focus('end');
    },
  }), []);

  return <RichTextEditor
    key={resetKey}
    id="comment-body"
    className="blog-comments__editor"
    aria-label="你的评论"
    defaultValue={EMPTY_DOC}
    extensions={markdownExtension}
    isDisabled={isDisabled}
    placeholder={placeholder}
    onValueChange={(_value, details) => {
      editorRef.current = details.editor;
      onChange(serializeBody(details.editor));
    }}
    editorOptions={{
      onCreate: ({editor}) => {
        editorRef.current = editor;
      },
      onDestroy: () => {
        editorRef.current = null;
      },
    }}
  >
    <RichTextEditor.Shell>
      <RichTextEditor.Toolbar aria-label="评论格式">
        <RichTextEditor.ToolbarGroup>
          <RichTextEditor.ToggleButton command="bold" isIconOnly size="sm" variant="ghost" tooltip="粗体"><Bold width={16} height={16} /></RichTextEditor.ToggleButton>
          <RichTextEditor.ToggleButton command="italic" isIconOnly size="sm" variant="ghost" tooltip="斜体"><Italic width={16} height={16} /></RichTextEditor.ToggleButton>
          <RichTextEditor.ToggleButton command="code" isIconOnly size="sm" variant="ghost" tooltip="行内代码"><Code width={16} height={16} /></RichTextEditor.ToggleButton>
        </RichTextEditor.ToolbarGroup>
        <RichTextEditor.ToolbarSeparator />
        <RichTextEditor.ToolbarGroup>
          <RichTextEditor.LinkPopover>
            <RichTextEditor.LinkPopover.Trigger isIconOnly size="sm" variant="ghost" tooltip="链接"><Link width={16} height={16} /></RichTextEditor.LinkPopover.Trigger>
            <RichTextEditor.LinkPopover.Content>
              <RichTextEditor.LinkPopover.Input placeholder="https://example.com" />
              <RichTextEditor.LinkPopover.Actions>
                <RichTextEditor.LinkPopover.UnsetButton />
                <RichTextEditor.LinkPopover.ApplyButton />
              </RichTextEditor.LinkPopover.Actions>
            </RichTextEditor.LinkPopover.Content>
          </RichTextEditor.LinkPopover>
        </RichTextEditor.ToolbarGroup>
        <RichTextEditor.ToolbarSeparator />
        <RichTextEditor.ToolbarGroup>
          <RichTextEditor.ToggleButton command="blockquote" isIconOnly size="sm" variant="ghost" tooltip="引用"><QuoteOpen width={16} height={16} /></RichTextEditor.ToggleButton>
          <RichTextEditor.ToggleButton command="codeBlock" isIconOnly size="sm" variant="ghost" tooltip="代码块"><CurlyBrackets width={16} height={16} /></RichTextEditor.ToggleButton>
          <RichTextEditor.ToggleButton command="bulletList" isIconOnly size="sm" variant="ghost" tooltip="无序列表"><ListUl width={16} height={16} /></RichTextEditor.ToggleButton>
          <RichTextEditor.ToggleButton command="orderedList" isIconOnly size="sm" variant="ghost" tooltip="有序列表"><ListOl width={16} height={16} /></RichTextEditor.ToggleButton>
        </RichTextEditor.ToolbarGroup>
        <Tooltip>
          <Avatar size="sm" className="blog-comments__editor-author" aria-label={authorName}>
            {authorImageUrl && <Avatar.Image src={authorImageUrl} alt="" />}
            <Avatar.Fallback>{authorName.slice(0, 1) || '我'}</Avatar.Fallback>
          </Avatar>
          <Tooltip.Content placement="bottom end">{authorName}</Tooltip.Content>
        </Tooltip>
      </RichTextEditor.Toolbar>
      <RichTextEditor.Content />
    </RichTextEditor.Shell>
    <span className="blog-comments__sr-only" aria-live="polite">
      {overLimit ? `评论已超过 ${COMMENT_BODY_MAX_LENGTH.toLocaleString()} 字上限，请缩短后再发布。` : ''}
    </span>
  </RichTextEditor>;
});

export default CommentComposer;
