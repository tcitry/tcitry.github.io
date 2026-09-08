import {Card, Chip} from '@heroui/react';
import type {RelatedPostPreview} from '../../lib/related-post-preview';
import './RelatedPostsCards.css';
import styles from './RelatedPosts.module.css';

interface Props {
  cards: RelatedPostPreview[];
  anchorId: string;
}

/** Static server rendering keeps each recommendation a normal document link. */
export default function RelatedPostsCards({cards, anchorId}: Props) {
  return <ul className={styles.cards} role="list" data-book-island>
    {cards.map((card, index) => {
      const titleId = `${anchorId}-card-${index + 1}-title`;
      return <li key={card.href} className={styles.item}>
        <a href={card.href} className={styles.link} aria-labelledby={titleId} data-related-post-link>
          <Card variant="secondary" className={styles.card}>
            <Card.Header>
              <Card.Title id={titleId} className={styles.title}>{card.title}</Card.Title>
            </Card.Header>
            {card.description && <Card.Content>
              <Card.Description className={styles.description}>{card.description}</Card.Description>
            </Card.Content>}
            <Card.Footer className={styles.footer}>
              {card.topics.length > 0 && <div className={styles.topics}>
                {card.topics.slice(0, 2).map((topic) => <Chip key={topic} size="sm" variant="soft" color="accent" className={styles.topic}>
                  <Chip.Label className={styles.topicLabel}>{topic}</Chip.Label>
                </Chip>)}
              </div>}
              {card.dateLabel && <time className={styles.date} dateTime={card.date}>{card.dateLabel}</time>}
            </Card.Footer>
          </Card>
        </a>
      </li>;
    })}
  </ul>;
}
