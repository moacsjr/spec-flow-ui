import { Mdx } from './Mdx';

interface DescriptionProps {
  source: string;
}

export function Description({ source }: DescriptionProps) {
  return (
    <section className="panel description">
      <div className="description__head">
        <h2 className="h2">Descrição</h2>
        <span className="badge-mono">MDX</span>
      </div>
      <Mdx source={source} />
    </section>
  );
}
