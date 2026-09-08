import {Pagination} from '@heroui/react';
import {paginationVariants} from '@heroui/styles';
import './WeeklyPagination.css';

interface WeeklyPaginationProps {
  current: number;
  urls: string[];
}

/** Keep archive navigation usable without JavaScript, including opening links in new tabs. */
export default function WeeklyPagination({current, urls}: WeeklyPaginationProps) {
  if (urls.length < 2) return null;

  const slots = paginationVariants();
  const previous = urls[current - 2];
  const next = urls[current];
  const visible = urls.map((href, index) => ({href, page: index + 1})).filter(({page}) =>
    urls.length <= 7 || page === 1 || page === urls.length || Math.abs(page - current) <= 1,
  );

  return <Pagination aria-label="周刊分页" data-weekly-pagination data-book-island>
    <Pagination.Content>
      <Pagination.Item>
        {previous ? <a className={slots.link({className: 'pagination__link--nav'})} href={previous} rel="prev" aria-label="上一页">
          <Pagination.PreviousIcon />
          <span>上一页</span>
        </a> : <Pagination.Previous isDisabled aria-label="上一页">
          <Pagination.PreviousIcon />
          <span>上一页</span>
        </Pagination.Previous>}
      </Pagination.Item>
      {visible.flatMap(({href, page}, index) => {
        const link = <Pagination.Item key={page}>
          <a className={slots.link()} href={href} aria-label={`第 ${page} 页`} aria-current={page === current ? 'page' : undefined} data-active={page === current ? 'true' : undefined}>{page}</a>
        </Pagination.Item>;
        return index > 0 && page - visible[index - 1].page > 1
          ? [<Pagination.Item key={`gap-${page}`}><Pagination.Ellipsis /></Pagination.Item>, link]
          : [link];
      })}
      <Pagination.Item>
        {next ? <a className={slots.link({className: 'pagination__link--nav'})} href={next} rel="next" aria-label="下一页">
          <span>下一页</span>
          <Pagination.NextIcon />
        </a> : <Pagination.Next isDisabled aria-label="下一页">
          <span>下一页</span>
          <Pagination.NextIcon />
        </Pagination.Next>}
      </Pagination.Item>
    </Pagination.Content>
  </Pagination>;
}
