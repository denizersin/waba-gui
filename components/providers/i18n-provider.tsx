'use client';

import { PropsWithChildren } from 'react';
import '../../lib/i18n';

export default function I18nProvider({ children }: PropsWithChildren) {
    return <>{children}</>;
}
